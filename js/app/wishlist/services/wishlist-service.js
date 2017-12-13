/**
 * [y] hybris Platform
 *
 * Copyright (c) 2000-2016 hybris AG
 * All rights reserved.
 *
 * This software is the confidential and proprietary information of hybris
 * ("Confidential Information"). You shall not disclose such Confidential
 * Information and shall use it only in accordance with the terms of the
 * license agreement you entered into with hybris.
 */

'use strict';

angular.module('ds.wishlist')

    .factory('WishlistSvc', ['$rootScope', 'GlobalData', 'WishlistREST','ProductSvc', 'AccountSvc', 'PriceSvc', '$q',
        function ($rootScope, GlobalData, WishlistREST, ProductSvc, AccountSvc, PriceSvc, $q) {

            // Prototype for outbound "create wishlist item" call
            var Item = function (product, price, amount, note) {
                this.product = product;
                this.price = price;
                this.amount = amount;
                this.note = note;
            };

            // Prototype for outbound "create wishlist" call
            var Wishlist = function () {
                this.id = '';
                this.items = [];
            };

            // application scope wishlist instance
            var wishlist = new Wishlist();

            /**
              * Initialize status of wishlist.
              * 0: uninitialize
              * 1: initializing
              * 2: initialized
              */
            var wishlistStatus = {
                status: 0,
                promises: []
            };

            function changeWishlistStatus(status) {
                _.forEach(wishlistStatus.promises, function(promise) {
                    if(status === 2) {
                        promise.resolve();
                    } else {
                        promise.reject();
                    }
                });
                wishlistStatus.status = status;
                wishlistStatus.promises = [];
            }

            /**  Create a wishlist associated with the current session.
             */
            function createWishlist() {
                var deferred = $q.defer();

                var newWishlist = new Wishlist();
                var accPromise = AccountSvc.getCurrentAccount();
                accPromise.then(function (successAccount) {
                    newWishlist.owner = successAccount.id;
                    // FIXME: use user's email as title temporarily
                    newWishlist.title = successAccount.contactEmail;
                });
                accPromise.finally(function () {
                    WishlistREST.Wishlist.all('wishlists').post(newWishlist).then(function (response) {
                        wishlist = response.plain();
                        wishlist.items = [];
                        $rootScope.$emit('wishlist:updated', { wishlist: wishlist, source: 'auto' });
                        deferred.resolve();
                    }, function () {
                        deferred.reject();
                    });
                });

                return deferred.promise;
            }

            function getOrCreateWishlist() {
                var deferred = $q.defer();

                if (wishlistStatus.status === 0) {
                    // Uninitialize, change to initializing
                    changeWishlistStatus(1);
                    // Retrieve all wishlists to find the one assotiated with the authenticated user
                    AccountSvc.getCurrentAccount().then(function (account) {
                        var customerId = account.id;
                        WishlistREST.Wishlist.all('wishlists').getList().then(function (response) {
                            angular.forEach(response.plain(), function (remoteWishlist) {
                                if (remoteWishlist.owner === customerId) {
                                    wishlist = remoteWishlist;
                                    wishlist.items = [];
                                }
                            });

                            if (wishlist.id) {
                                refreshWishlist(wishlist.id).then(function () {
                                    deferred.resolve({ wishlistId: wishlist.id });
                                    changeWishlistStatus(2);
                                }, function () {
                                    deferred.reject();
                                    changeWishlistStatus(0);
                                });
                            } else {
                                createWishlist().then(function () {
                                    deferred.resolve({ wishlistId: wishlist.id });
                                    changeWishlistStatus(2);
                                }, function () {
                                    deferred.reject();
                                    changeWishlistStatus(0);
                                });
                            }
                        }, function() {
                            deferred.reject();
                            changeWishlistStatus(2);
                        });
                    }, function () {
                        deferred.reject();
                        changeWishlistStatus(0);
                    });
                } else if (wishlistStatus.status === 1) {
                    // Initializing, record this promise for further processing
                    wishlistStatus.promises.push(deferred);
                } else {
                    // Initialized, resolve it immediately
                    deferred.resolve({ wishlistId: wishlist.id });
                }
                return deferred.promise;
            }

            /** Fill wishlist items with product info. This function will be
             * used recursively since we don't want to fetch all products
             * info at one time to avoid exceeding length of request URI.
             * I also updates the local instance and finally fires the
             * 'wishlist:updated' event.
             * */
            function fillWishlistItems(items, start, deferred) {
                // Fetch 16 products at one time
                var queryNumber = 16;
                var pageNumber = start / queryNumber;
                var pageSize = Math.min(items.length - start, queryNumber);

                if (pageSize <= 0) {
                    // Finish to fill all wishlist items, update wishlist
                    // Add the currency symbol
                    wishlist.currencySymbol = GlobalData.getCurrencySymbol();
                    $rootScope.$emit('wishlist:updated', { wishlist: wishlist, source: 'auto' });
                    deferred.resolve();
                    return;
                }

                var queryItems = items.slice(start, start + pageSize);
                var ids = getProductIdsFromWishlist(queryItems);
                var param = {
                    q: 'id:('+ids+')',
                    pagenumber: pageNumber,
                    pageSize: pageSize
                };

                ProductSvc.queryProductList(param).then(function(res){
                    var products = res.plain();
                    PriceSvc.getPricesMapForProducts(products, GlobalData.getCurrencyId()).then(function (prices) {
                        _.forEach(queryItems, function(item) {
                            if(item.product) {
                                var prod = _.find(products, {id: item.product});
                                if (prod) {
                                    item.name = prod.name;
                                }
                                if (prices[item.product]) {
                                    item.price = prices[item.product].singlePrice;
                                    // Show the minimum price if exist
                                    if (prices[item.product].minPrice) {
                                        item.price = prices[item.product].minPrice;
                                    }
                                }
                            }
                        });

                        wishlist.items = wishlist.items.concat(queryItems);
                        start += pageSize;
                        fillWishlistItems(items, start, deferred);
                    }, function () {
                        deferred.reject();
                    });
                }, function () {
                    deferred.reject();
                });
            }

            /** Retrieves all wishlist items from the service */
            function refreshWishlist(wishlistId) {
                var deferred = $q.defer();

                WishlistREST.Wishlist.one('wishlists', wishlistId).all('wishlistItems').getList()
                        .then(function (response) {
                    var items = response.plain();
                    if (items.length > 0) {
                        fillWishlistItems(items, 0, deferred);
                    } else {
                        wishlist.items = [];
                        $rootScope.$emit('wishlist:updated', { wishlist: wishlist, source: 'auto' });
                        deferred.resolve();
                    }
                }, function () {
                    deferred.reject();
                });

                return deferred.promise;
            }

            /** Creates a new Wishlist Item. */
            function createWishlistItem(product, prices, note) {
                var deferred = $q.defer();

                if (wishlist.id) {
                    var productId = _.has(product, 'itemYrn') ? product.itemYrn.split(';')[1] : product.id;
                    var item = new Item(productId, prices[0], 1, note);

                    WishlistREST.Wishlist.one('wishlists', wishlist.id).all('wishlistItems').post(item).then(function (response) {
                        item.createdAt = response.plain().createdAt;
                        item.name = product.name;
                        wishlist.items.push(item);
                        $rootScope.$emit('wishlist:updated', { wishlist: wishlist, source: 'auto' });
                        deferred.resolve();
                    }, function () {
                        deferred.reject();
                    });
                } else {
                    deferred.reject();
                }

                return deferred.promise;
            }

            function getProductInWishlist(product){
                var productId = _.has(product, 'itemYrn') ? product.itemYrn.split(';')[1] : product.id;
                return _.find((wishlist.items ? wishlist.items : []),function(item){
                    if(item.product === productId){
                        return item;
                    }
                });
            }

            function getProductIdsFromWishlist(items){
                return _.map(items, function(item){
                    return item.product ? item.product : '';
                }).join(',');
            }

            return {

                /** Find a wishlist item referred to the product id. */
                findWishlistItem: function (product) {
                    return getProductInWishlist(product);
                },

                /** Reset wishlist once logout. */
                resetWishlist: function () {
                    changeWishlistStatus(0);
                    wishlist = new Wishlist();
                    $rootScope.$emit('wishlist:updated', { wishlist: wishlist, source: 'reset' });
                },

                /** Returns the wishlist as stored in the local scope - no GET is issued.*/
                getLocalWishlist: function () {
                    return wishlist;
                },

                /** Retrieve any existing wishlist for an authenticated user. */
                refreshWishlistAfterLogin: getOrCreateWishlist,

                /** Refresh wishlist after language changed. */
                refreshWishlist: function() {
                    if (wishlist.id) {
                        return refreshWishlist(wishlist.id);
                    }
                },

                /** Update wishlist item info. */
                updateWishlistItemInfo: function (/*item, amount, note*/) {
                    var deferred = $q.defer();
                    // TODO: unimplemented
                    deferred.reject();
                    return deferred.promise;
                },

                /** Remove wishlist item. */
                removeWishlistItem: function (/*item*/) {
                    var deferred = $q.defer();
                    // TODO: unimplemented
                    deferred.reject();
                    return deferred.promise;
                },

                /*
                 *   Adds a product to the wishlist
                 *   @param product to add
                 *   @param prices prices of product
                 *   @return promise over success/failure
                 */
                addProductToWishlist: function (product, prices, note) {
                    var deferred = $q.defer();

                    getOrCreateWishlist().then(function () {
                        if (getProductInWishlist(product)) {
                            deferred.resolve();
                        } else {
                            createWishlistItem(product, prices, note).then(function () {
                                deferred.resolve();
                            }, function () {
                                deferred.reject();
                            });
                        }
                    }, function () {
                        deferred.reject();
                    });

                    return deferred.promise;
                },

                /** Get the total price amount of all products in wishlist. */
                getWishlistTotalPriceAmount: function () {
                    var deferred = $q.defer();

                    getOrCreateWishlist().then(function () {
                        var totalPrice = 0;
                        angular.forEach(wishlist.items, function (item) {
                            // Use the effective amount instead of original amount
                            totalPrice += item.price.effectiveAmount * item.amount;
                        });
                        deferred.resolve( {totalPrice: totalPrice} );
                    }, function () {
                        deferred.reject();
                    });

                    return deferred.promise;
                }
            };

        }]);
