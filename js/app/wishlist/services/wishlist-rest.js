/**
 * [y] hybris Platform
 *
 * Copyright (c) 2000-2015 hybris AG
 * All rights reserved.
 *
 * This software is the confidential and proprietary information of hybris
 * ("Confidential Information"). You shall not disclose such Confidential
 * Information and shall use it only in accordance with the terms of the
 * license agreement you entered into with hybris.
 */

'use strict';

angular.module('ds.wishlist')
    .factory('WishlistREST', ['Restangular', '$location', 'GlobalData', function(Restangular, $location, GlobalData){

        return {
            /** Endpoint for Main Wishlist.*/
            Wishlist: Restangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setBaseUrl('http://' + $location.host() + ':9001');
                RestangularConfigurer.addFullRequestInterceptor(function (element, operation, route, url, headers, params, httpConfig) {
                    return {
                        element: element,
                        params: params,
                        headers: _.extend(headers, { 'hybris-site': GlobalData.getSiteCode() }),
                        httpConfig: httpConfig
                    };
                });
            })
        };

    }]);
