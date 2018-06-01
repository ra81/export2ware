// ==UserScript==
// @name          Вывоз на склад
// @namespace     virtonomica
// @description   Массовый вывоз товара из магазина на склады в 1 клик.
// @version       1.0
// @include       http*://virtonomic*.*/*/main/unit/view/*/sale
// @include       http*://virtonomic*.*/*/main/unit/view/*/trading_hall
// @require       https://code.jquery.com/jquery-1.11.1.min.js
// @require       https://raw.githubusercontent.com/pieroxy/lz-string/master/libs/lz-string.min.js
// ==/UserScript==

/// <reference path= "../../_jsHelper/jsHelper/jsHelper.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.0_PageParserFunctions.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_CompanyParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_GeoParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_MiscParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_RetailParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_WareParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/7.1_WorkshopParsers.ts" />
/// <reference path= "../../XioPorted/PageParsers/8_API.ts" />
/// <reference path= "../../XioPorted/PageParsers/1_Exceptions.ts" />
