


$ = jQuery = jQuery.noConflict(true);
let $xioDebug = true;
let Realm = getRealmOrError();
let GameDate = parseGameDate(document);

let Export2WareStoreKeyCode = "e2w";
let ProdCatStoreKeyCode = "prct";   // сделал неким отдельным ключиком, вдруг будет скрипт читающий эту же табличку
let EnablePriceMgmnt = true;        // если выключить то кнопки изменения цен исчезнут
let EnableExport2w = true;          // если выключить то функции экспорт ВСЕ перестанут работать

// упрощаем себе жисть, подставляем имя скрипта всегда в сообщении
function log(msg: string, ...args: any[]) {

    msg = "export2ware: " + msg;
    logDebug(msg, ...args);
}

interface IWareProps {
    name: string;
    city: string;
    spec: string;
    products: IProduct[];
}

async function run_async() {

    let Url_rx = {
        // для юнита
        unit_sale: /\/[a-z]+\/(?:main|window)\/unit\/view\/\d+\/sale\/?/i,          // продажа склад/завод
        unit_trade_hall: /\/[a-z]+\/(?:main|window)\/unit\/view\/\d+\/trading_hall\/?/i, // торговый зал
    };

    let $html = $(document);

    // определяем где мы находимся. для трейдхолла может не быть вообще товара, тады нет таблицы.
    let onTradehall = Url_rx.unit_trade_hall.test(document.location.pathname) && $html.find("table.grid").length > 0;
    let onWareSale = Url_rx.unit_sale.test(document.location.pathname) && parseUnitType($html) == UnitTypes.warehouse;

    if (onTradehall && EnableExport2w)
        await tradehallExport_async();

    if (onTradehall && EnablePriceMgmnt)
        tradehallPrice();

    if (onWareSale)
        wareSale();

    async function tradehallExport_async() {
        //  задаем стили для выделения
        //$("<style>")
        //    .prop("type", "text/css")
        //    .html(`.e2wSelected { background-color: rgb(255, 210, 170) !important; }`)
        //    .appendTo(document.head);
        let selClassName = "selected";  // класс которым будем выделять строки доступные для экспорта

        // собираем данные с хранилища
        let exportWares = restore();
        let prodCatDict = await getProdWithCategories_async();
        let getCategory = (pid: number) => nullCheck(prodCatDict[pid]).category_name;

        // для каждого товара удалим штатные события дабы свои работали нормально
        // и удалим обработчик на общую галку. она будет работать иначе
        let $rows = closestByTagName($html.find("table.grid a.popup"), "tr");
        $rows.removeAttr("onmouseover").removeAttr("onmouseout").removeClass("selected");
        let $globalChbx = oneOrError($html, "#allProduct").removeAttr("onclick");


        // запили массив со связкой pid, отдел, строка, чекбокс. для ускорения и удобства всей работы дальше
        interface ICache {
            available: number;   // сколько на складе лежит
            sold: number;        // сколько продано
            pid: number;
            category: string;
            row: JQuery,    // строка
            cbx: JQuery     // чекбокс в строке
        };
        let $form = $html.find("form");
        let [, thItems] = parseUnitTradeHall(document, document.location.pathname);
        let dataCache: ICache[] = [];
        for (let thItem of thItems) {
            let $r = oneOrError($form, `input[name='${thItem.name}']`).closest("tr");
            let $cbx = oneOrError($r, "input:checkbox");

            dataCache.push({
                available: thItem.stock.available,
                sold: thItem.stock.sold,
                category: getCategory(thItem.product.id),
                pid: thItem.product.id,
                row: $r,
                cbx: $cbx
            });
        }


        // формируем словарь Отдел => pid[] для отрисовки селекта отделов. Пустые товары выкидываем.
        let catsDict: IDictionary<number[]> = {};
        for (let item of dataCache) {
            if (item.available <= 0)
                continue;

            if (catsDict[item.category] == null)
                catsDict[item.category] = [];

            catsDict[item.category].push(item.pid);
        }

        // оставляем только склады на которые можно что то вывезти
        exportWares = filterWares(exportWares, dataCache.map((v, i, a) => v.pid));

        // для вывода в селект, формируем для каждого склада список отделов для которых склад может быть использован
        // subid => {category => goodsCount}
        let wareCats: IDictionaryN<IDictionary<number>> = {};
        for (let subid in exportWares) {
            let wp = exportWares[subid];
            let cats = categories(wp.products, prodCatDict);
            if (dictKeys(cats).length <= 0)
                throw new Error(`что то пошло не так, список категорий для склада ${wp.name} пустой`);

            wareCats[subid] = cats;
        }



        // размещение селектов
        //
        // cелект для списка отделов
        let $catSel = $(`<select id="exportCats"><option value="off"> ------ </option></select>`);
        for (let catName in catsDict) {
            let cnt = catsDict[catName];
            let opt = `<option value="${catName}">${catName} (${cnt.length})</option>`;
            $catSel.append(opt);
        }

        // cелект со складами
        let $wareSel = $(`<select id="exportWares"><option value="off"> ------ </option></select>`);
        for (let key in exportWares) {
            let subid = parseInt(key);
            let wp = exportWares[subid];
            let cats = wareCats[subid];

            // из словаря категорий формируем массив строк для удобства
            let catsStrArr: string[] = [];
            for (let catName in cats)
                catsStrArr.push(`${catName} (${cats[catName]})`);

            // список всех категорий в тултип суем
            let tooltipStr = `${wp.city} (${wp.spec})\n-----------\n${catsStrArr.join("\n")}`;
            let opt = `<option value="${subid}" title="${tooltipStr}">${wp.name} (${wp.spec})</option>`;
            $wareSel.append(opt);
        }

        // суем селекты и подравниваем ширину
        let $div = $(`<div style="margin:10px 0 0 10px; display:inline-block"></div>`).append($catSel, "<br>", $wareSel);
        $html.find("table.list").before($div);
        let ws = $div.find("select").map((i, el) => $(el).width()).get() as any as number[];
        $div.find("select").width(Math.max(100, ...ws));    // минимально 100 пикселей

        // выбор селекта отделов, автоматом формирует селект складов для данного отдела
        $catSel.on("change", function (this: any, event: JQueryEventObject) {
            //console.log("catSel.changed fired");
            let $s = $(this);
            let selectedCat = $s.val();

            // все склады не содержащие нужные отделы, скроем из селекта
            $wareSel.trigger("catChanged", selectedCat);
        });

        // обновился выбор категории, обновить надо список складов
        $wareSel.on("catChanged", function (this: any, event: JQueryEventObject, selectedCat: string) {
            //console.log("wareSe.catChanged fired");
            let $s = $(this);
            let val = $s.val();   // off || ware

            let $options = $s.find("option");

            // если сброс категории, то покажем все склады
            if (selectedCat == "off") {
                $options.show();
                if (val != "off") {
                    $s.val("off");
                    $s.trigger("change");
                }
                return;
            }

            // скроем часть складов которые недоступны для категории
            $options.each((i, e) => {
                let $o = $(e);
                if ($o.val() == "off")
                    return;

                let subid = parseInt($o.val());
                if (wareCats[subid][selectedCat] == null)
                    $o.hide();
                else
                    $o.show();
            });

            if (val != "off") {
                $s.val("off");
                $s.trigger("change");
            }
        });

        $wareSel.on("change", function (this: any, event: JQueryEventObject) {
            //console.log("wareSel.changed fired");
            let $s = $(this);
            let val = $s.val();    //off || subid
            let selectedCat = $catSel.val();

            if (val == "off") {
                // убираем подсветку и разрешаем тыкать все галочки что есть
                for (let obj of dataCache) {
                    obj.row.removeClass(selClassName);
                    obj.cbx.prop("checked", false).prop("disabled", false);
                }
                return;
            }
            else {
                // подсвечивать будем только в соответствии с выбранным отделом, ну или все если отдел не выбран
                let subid = parseInt(val);
                let wp = exportWares[subid];
                for (let obj of dataCache) {
                    let wareHasIt = wp.products.find((v, i) => obj.pid == v.id) != null;
                    let exportable = wareHasIt && obj.available > 0 && (selectedCat == "off" || selectedCat == obj.category)
                    if (exportable) {
                        obj.row.toggleClass(selClassName, true);
                        obj.cbx.prop("checked", true).prop("disabled", false);
                    }
                    else {
                        obj.row.removeClass(selClassName);
                        obj.cbx.prop("checked", false).prop("disabled", true);
                    }
                }
            }
        });


        // глобальный чекбокс надо заставить работать иначе, чтобы он учитывал наши ограничения
        //
        $globalChbx.on("click", function (this: any, event: JQueryEventObject) {
            let $chbx = $(this);
            let checked = $chbx.prop("checked") == true;
            let selectedCat = $catSel.val();
            let selectedWare = $wareSel.val();

            // если выбран отдел, то только в рамках отдела. А если выбран склад то только в рамках склада
            if (checked) {
                if (selectedCat == "off" && selectedWare == "off") {
                    // просто выделяем все продукты
                    for (let item of dataCache)
                        item.cbx.prop("checked", true);
                }
                else if (selectedCat != "off" && selectedWare == "off"){
                    // выделяем только выбранный отдел
                    let cache = dataCache.filter((v, i, a) => v.category == selectedCat);
                    for (let item of cache)
                        item.cbx.prop("checked", true);
                }
                else if (selectedWare != "off") {
                    // тут тупо полагаемся на класс строки, так как при выборе склада всегда будет выделение
                    let cache = dataCache.filter((v, i, a) => v.row.hasClass(selClassName));
                    for (let item of cache)
                        item.cbx.prop("checked", true);
                }
            }
            else {
                for (let item of dataCache)
                    item.cbx.prop("checked", false);
            }
        });


        // Кнопка экспорта и сам экспорт
        //
        // вниз страницы суем кнопку экспорта
        let $expAllBtn = $(`<input type="button" id="doExport" class="button160 e2w"  data-mult="0" value="Вывезти всё">`);
        let $exp2Btn = $(`<input type="button" id="doExport2" class="button160 e2w" data-mult="2" value="Оставить 2*sold">`);
        let $exp3Btn = $(`<input type="button" id="doExport3" class="button160 e2w" data-mult="3" value="Оставить 3*sold">`);
        $html.find("table.buttonset_noborder input.button205").after($expAllBtn, $exp2Btn, $exp3Btn);

        $html.find("table.buttonset_noborder").on("click", "input.e2w", null, async function (this: any, event: JQueryEventObject) {

            // если не выбрано в селекте и нет галочек то нечего экспортить. хрен
            if ($wareSel.val() == "off") {
                alert("Не выбран склад на который вывозить товары.\nЭкспорт невозможен.");
                return;
            }

            let pids = dataCache.filter((v, i, a) => v.cbx.prop("checked") == true).map((v, i, a) => [v.pid, v.available, v.sold]);
            if (pids.length <= 0) {
                alert("Не выбрано ни одного товара.\nЭкспорт невозможен.");
                return;
            }

            // чето выбрано, надо таки экспортить
            //console.log(pids.map((v, i, a) => prodCatDict[v].name));


            // subid
            let n = extractIntPositive(document.location.pathname);
            if (n == null)
                throw new Error(`на нашел subid юнита в ссылке ${document.location.pathname}`);

            let subid = n[0];
            let wareSubid = numberfyOrError($wareSel.val());

            // теперь надо множитель дернуть для остатка
            let mult = numberfyOrError($(this).data("mult"), -1);

            for (let [pid,available,sold] of pids) {
                let url = `/${Realm}/window/unit/view/${subid}/product_move_to_warehouse/${pid}/0`;
                let data = {
                    qty: available - sold * mult,
                    unit: wareSubid,
                    doit: "Ok"
                };
                await tryPost_async(url, data); // если задать неадекватный адрес склада то молча не вывозит и все.
                //console.log(data);
            }

            document.location.reload();
        });
    }

    function tradehallPrice() {
        let $inputs = $html.find("input[name^='productData[price]'");
        $inputs.each((i, e) => {
            let $inp = $(e);
            $inp.before(`<input type='button' class="pm" data-oper='dec' value='-'>`);
            $inp.after(`<input type='button' class="pm" data-oper='inc' value='+'>`);
        });

        oneOrError($html, "table.grid").on("click", "input.pm", null, function (this: any, event: JQueryEventObject) {
            //console.log("input.pm click fired");
            let $btn = $(this);
            let oper = $btn.data("oper");

            let $price = oneOrError($btn.closest("td"), "input:text");
            let price = numberfyOrError($price.val());
            price = oper == "inc" ? price * 1.1 : price * 0.9;
            $price.val(price.toFixed(2));
        });
    }

    function wareSale() {
        // subid 
        let n = extractIntPositive(document.location.pathname);
        if (n == null)
            throw new Error(`на нашел subid юнита в ссылке ${document.location.pathname}`);

        let subid = n[0];

        // name
        let [name, city] = parseUnitNameCity($html);


        let dict = restore();
        let isSaved = dict[subid] != null;
        let saveWare = () => {
            // собираем всю инфу по товарам которые может хранить собственно сей склад и подготавливаем Запись
            let [, saleItems] = parseWareSaleNew(document, document.location.pathname);
            let products = dictValues(saleItems).map((v, i, a) => v.product);

            dict[subid] = {
                name: name,
                city: city,
                products: products,
                spec: spec
            };

            store(dict);
        }
        let deleteWare = ()=> {
            delete dict[subid];
            store(dict);
        }

        // если спецуха изменилась, то обновим данные по складу
        let spec = oneOrError($html, "table:has(a.popup[href*='speciality_change'])").find("td").eq(2).text().trim();
        if (isSaved && dict[subid].spec != spec)
            saveWare();

        // рисуем кнопки хуёпки
        let html = `<input type="checkbox" ${isSaved ? "checked" : ""} id="saveWare" style="margin-left:30px"><label for="saveWare">Запомнить склад</label>`;
        $html.find("label[for='filter-empty-qty']").after(html);

        $html.find("#saveWare").on("click", (event) => {
            let $cbx = $(event.target);
            if ($cbx.prop("checked"))
                saveWare();
            else
                deleteWare();
        });
    }
}

/**
 * Сохраняет данные в хранилище
 * @param dict
 */
function store(dict: IDictionaryN<IWareProps>) {
    nullCheck(dict);

    let storageKey = buildStoreKey(Realm, Export2WareStoreKeyCode);
    localStorage[storageKey] = LZString.compress(JSON.stringify(dict));
}
/**
 * Возвращает считанный словарь складов для экспорта либо пустой словарь если ничего нет
 */
function restore(): IDictionaryN<IWareProps> {

    // читаем с хранилища, есть ли данные по складу там
    let storageKey = buildStoreKey(Realm, Export2WareStoreKeyCode);
    let data = localStorage.getItem(storageKey);

    return data == null ? {} : JSON.parse(LZString.decompress(data));
}


/**
 * Читает с локалстораджа данные по розничным товарам с категориями.
   Если там нет, то тащит и сохраняет на будущее
 */
async function getProdWithCategories_async(): Promise<IDictionaryN<IProductAPI>> {
    let storageKey = buildStoreKey(Realm, ProdCatStoreKeyCode);
    let data = localStorage.getItem(storageKey);
    let todayStr = dateToShort(nullCheck(GameDate));

    // если сегодня уже данные засейвили, тогда вернем их
    // обновлять будем раз в день насильно. вдруг введут новые продукты вся херня
    if (data != null) {
        let [dateStr, prods] = JSON.parse(LZString.decompress(data));
        if (todayStr == dateStr)
            return prods;
    }

    // если данных по категориям еще нет, надо их дернуть и записать в хранилище на будущее
    let url = formatStr(`/api/{0}/main/product/goods`, Realm);
    log("Список всех розничных продуктов устарел. Обновляем.");
    let jsonObj = await tryGetJSON_async(url);
    let prods = parseRetailProductsAPI(jsonObj, url);
    localStorage[storageKey] = LZString.compress(JSON.stringify([todayStr, prods]));

    return prods;
}


/**
 * Для заданного набора продуктов выдает список розничных отделов c кол-вом продуктов в каждом
 * @param prods список продуктов
 * @param prodDict словарь содержащий данные по принадлежности продуктов к розничным отделам
 */
function categories(prods: IProduct[], prodCatDict: IDictionaryN<IProductAPI>) {
    let cats: IDictionary<number> = {};

    for (let p of prods) {
        let papi = prodCatDict[p.id];
        if (papi == null)
            throw new Error(`В словаре всех розничных продуктов не найден товар pid:${p.id} img:${p.img}`);

        cats[papi.category_name] = cats[papi.category_name] == null
            ? 1
            : cats[papi.category_name] + 1;
    }

    return cats;
}
/**
 * оставляем только склады которые могут хранить хоть 1 продукт из списка
   оставляем только те продукты на складе которые есть в магазине.
   ориентир по pid поэтому бренды будут оставаться даже если в магазе их нет. пофиг
   исходный словарь не затрагивает. формирует новый
 * @param waresDict  список складов
 * @param pids список pid искомых продуктов
 */
function filterWares(waresDict: IDictionaryN<IWareProps>, pids: number[]) {
    let resDict: IDictionaryN<IWareProps> = {};
    for (let subid in waresDict) {
        let wp = waresDict[subid];

        let ints = intersect(wp.products.map((v, i, a) => v.id), pids);
        if (ints.length <= 0)
            continue;

        // если есть на складе хранение брендованных, то их pid дублирует обычные товары и число хранения будет больше
        // ровно на число брендованных товаров
        resDict[subid] = {
            name: wp.name,
            city: wp.city,
            spec: wp.spec,
            products: wp.products.filter((v, i, a) => isOneOf(v.id, ints))
        };
    }

    return resDict;
}

// всякий мусор для работы всего
//
enum UnitTypes {
    unknown = 0, // для неописанных еще в коде юнитов
    animalfarm, // животновод ферам
    farm,       // любая ферма земля
    lab,         // лаборатория
    mill,
    mine,
    office,
    oilpump,
    orchard,
    sawmill,
    shop,
    seaport,
    warehouse,
    workshop,
    villa,
    fishingbase,
    service_light, fitness, laundry, hairdressing,
    medicine,
    restaurant,
    power, coal_power, incinerator_power, oil_power, sun_power,
    fuel,
    repair,
    apiary,
    educational, kindergarten,  // картинка внутри юнита для образовательных и в списке
    network, it, cellular,      // в юните и в списке
}
enum SalePolicies {
    nosale = 0,
    any,
    some,
    company,
    corporation
}
interface IDictionary<T> {
    [key: string]: T;
}
interface IDictionaryN<T> {
    [key: number]: T;
}
interface IProduct {
    name: string;
    img: string;    // полный путь картинки /img/products/clay.gif или /img/products/brand/clay.gif
    id: number
}
interface IProductAPI {
    id: number;             // => '422547',
    name: string;           // => 'Бурбон',
    symbol: string;         // => 'bourbon', по факту просто имя картинки без пути и gif
    img: string;
    category_id: number;    // => '1532',       // розничный отдел
    category_name: string;  //  => 'Бакалея',
}

interface IStock {
    available: number;
    product: IProductProperties;
}
interface IRetailStock extends IStock {
    sold: number;
    deliver: number;
    ordered: number;
}
interface IProductProperties {
    price: number;
    quality: number;
    brand: number;
}
interface ITradeHallItem {
    product: IProduct;
    stock: IRetailStock;

    reportUrl: string;
    historyUrl: string;

    dontSale: boolean;  // флаг говорящий что товар НЕ продается
    name: string;    // это name аттрибут текстбокса с ценой, чтобы удобно обновлять цены запросом
    share: number;
    price: number;  // текущая цена продажи
    city: IProductProperties;
}
interface ISaleWareItem {
    product: IProduct;
    stock: IStock;
    outOrdered: number;

    price: number;
    salePolicy: SalePolicies;
    maxQty: number | null;  // ограничение на макс объем заказа

    priceName: string;  // имена элементов для быстрого поиска по форме потом
    policyName: string;
    maxName: string;    // окно ввода максимума
}


function dictKeysN(dict: IDictionaryN<any>): number[] {
    return Object.keys(dict).map((v, i, arr) => parseInt(v));
}
function dictKeys(dict: IDictionary<any>): string[] {
    return Object.keys(dict);
}
function dictValues<T>(dict: IDictionary<T>): T[] {
    let res: T[] = [];
    for (let key in dict)
        res.push(dict[key]);

    return res;
}
function dictValuesN<T>(dict: IDictionaryN<T>): T[] {
    let res: T[] = [];
    for (let key in dict)
        res.push(dict[key]);

    return res;
}
function unique<T>(array: T[]): T[] {
    let res: T[] = [];
    for (let i = 0; i < array.length; i++) {
        let item = array[i];
        if (array.indexOf(item) === i)
            res.push(item);
    }

    return res;
}
function intersect<T>(a: T[], b: T[]): T[] {

    // чтобы быстрее бегал indexOf в A кладем более длинный массив
    if (b.length > a.length) {
        let t = b;
        b = a;
        a = t;
    }

    // находим пересечение с дублями
    let intersect: T[] = [];
    for (let item of a) {
        if (b.indexOf(item) >= 0)
            intersect.push(item);
    }

    // если надо удалить дубли, удаляем
    return unique(intersect);
}
function isOneOf<T>(item: T, arr: T[]) {
    if (arr.length <= 0)
        return false;

    return arr.indexOf(item) >= 0;
}
function getRealm(): string | null {
    // https://*virtonomic*.*/*/main/globalreport/marketing/by_trade_at_cities/*
    // https://*virtonomic*.*/*/window/globalreport/marketing/by_trade_at_cities/*
    let rx = new RegExp(/https:\/\/virtonomic[A-Za-z]+\.[a-zA-Z]+\/([a-zA-Z]+)\/.+/ig);
    let m = rx.exec(document.location.href);
    if (m == null)
        return null;

    return m[1];
}
function getRealmOrError(): string {
    let realm = getRealm();
    if (realm === null)
        throw new Error("Не смог определить реалм по ссылке " + document.location.href);

    return realm;
}
function getOnlyText(item: JQuery): string[] {

    // просто children() не отдает текстовые ноды.
    let $childrenNodes = item.contents();
    let res: string[] = [];
    for (let i = 0; i < $childrenNodes.length; i++) {
        let el = $childrenNodes.get(i);
        if (el.nodeType === 3)
            res.push($(el).text());     // так как в разных браузерах текст запрашивается по разному, 
        // универсальный способ запросить через jquery
    }

    return res;
}
function monthFromStr(str: string) {
    let mnth = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
    for (let i = 0; i < mnth.length; i++) {
        if (str.indexOf(mnth[i]) === 0)
            return i;
    }

    return null;
}
function extractDate(str: string): Date | null {
    let dateRx = /^(\d{1,2})\s+([а-я]+)\s+(\d{1,4})/i;
    let m = dateRx.exec(str);
    if (m == null)
        return null;

    let d = parseInt(m[1]);
    let mon = monthFromStr(m[2]);
    if (mon == null)
        return null;

    let y = parseInt(m[3]);

    return new Date(y, mon, d);
}
function parseGameDate(html: any): Date | null {
    let $html = $(html);

    try {
        // вытащим текущую дату, потому как сохранять данные будем используя ее
        let $date = $html.find("div.date_time");
        if ($date.length !== 1)
            return null;
        //throw new Error("Не получилось получить текущую игровую дату");

        let currentGameDate = extractDate(getOnlyText($date)[0].trim());
        if (currentGameDate == null)
            return null;
        //throw new Error("Не получилось получить текущую игровую дату");

        return currentGameDate;
    }
    catch (err) {
        throw err;
    }
}
function logDebug(msg: string, ...args: any[]) {
    if (!$xioDebug)
        return;

    console.log(msg, ...args);
}
function buildStoreKey(realm: string | null, code: string, subid?: number): string {
    if (code.length === 0)
        throw new RangeError("Параметр code не может быть равен '' ");

    if (realm != null && realm.length === 0)
        throw new RangeError("Параметр realm не может быть равен '' ");

    if (subid != null && realm == null)
        throw new RangeError("Как бы нет смысла указывать subid и не указывать realm");

    let res = "^*";  // уникальная ботва которую добавляем ко всем своим данным
    if (realm != null)
        res += "_" + realm;

    if (subid != null)
        res += "_" + subid;

    res += "_" + code;

    return res;
}
function nullCheck<T>(val: T | null | undefined): T {

    if (val == null)
        throw new Error(`nullCheck Error`);

    return val;
}
function dateToShort(date: Date): string {
    let d = date.getDate();
    let m = date.getMonth() + 1;
    let yyyy = date.getFullYear();

    let dStr = d < 10 ? "0" + d : d.toString();
    let mStr = m < 10 ? "0" + m : m.toString();

    return `${dStr}.${mStr}.${yyyy}`;
}
function formatStr(str: string, ...args: any[]): string {
    let res = str.replace(/{(\d+)}/g, (match, number) => {
        if (args[number] == null)
            throw new Error(`плейсхолдер ${number} не имеет значения`);

        return args[number];
    });
    return res;
}
function parseJSON(jsonStr: string): any {
    let obj = JSON.parse(jsonStr, (k, v) => {
        if (v === "t") return true;
        if (v === "f") return false;

        return (typeof v === "object" || isNaN(v)) ? v : parseFloat(v);
    });

    return obj;
}
async function tryGetJSON_async(url: string, retries: number = 10, timeout: number = 1000): Promise<any> {
    let $deffered = $.Deferred<string>();

    $.ajax({
        url: url,
        type: "GET",
        cache: false,
        dataType: "text",

        success: (jsonStr, status, jqXHR) => {
            let obj = parseJSON(jsonStr);
            $deffered.resolve(obj);
        },

        error: function (this: JQueryAjaxSettings, jqXHR: JQueryXHR, textStatus: string, errorThrown: string) {
            retries--;
            if (retries <= 0) {
                let err = new Error(`can't get ${this.url}\nstatus: ${jqXHR.status}\ntextStatus: ${jqXHR.statusText}\nerror: ${errorThrown}`);
                $deffered.reject(err);
                return;
            }

            //logDebug(`ошибка запроса ${this.url} осталось ${retries} попыток`);
            let _this = this;
            setTimeout(() => {
                $.ajax(_this);
            }, timeout);
        }
    });

    return $deffered.promise();
}
async function tryPost_async(url: string, form: any, retries: number = 10, timeout: number = 1000): Promise<any> {

    let $deferred = $.Deferred<string>();
    $.ajax({
        url: url,
        data: form,
        type: "POST",

        success: (data, status, jqXHR) => $deferred.resolve(data),

        error: function (this: JQueryAjaxSettings, jqXHR: JQueryXHR, textStatus: string, errorThrown: string) {
            retries--;
            if (retries <= 0) {
                let err = new Error(`can't post ${this.url}\nstatus: ${jqXHR.status}\ntextStatus: ${jqXHR.statusText}\nerror: ${errorThrown}`);
                $deferred.reject(err);
                return;
            }

            //logDebug(`ошибка запроса ${this.url} осталось ${retries} попыток`);
            let _this = this;
            setTimeout(() => {
                $.ajax(_this);
            }, timeout);
        }
    });

    return $deferred.promise();
}

function parseRetailProductsAPI(jsonObj: any, url: string): IDictionaryN<IProductAPI> {
    try {
        let res: IDictionary<IProductAPI> = {};
        for (let pid in jsonObj) {
            let prod = jsonObj[pid];
            if (prod.symbol.length <= 0)
                throw new Error("пустая строка вместо символа продукта.");

            let img = `/img/products/${prod.symbol}.gif`;
            prod["img"] = img;

            res[pid] = prod;
        }

        return res;
    }
    catch (err) {
        throw err;
    }
}
function parseUnitNameCity($html: JQuery): [string, string] {
    let x: IProduct;

    // сюда либо прилетает ВСЯ страница либо только шапка. поэтому фильтры надо БЕЗ использования классов шапки
    // ниже нам придется ремувать элементы, поэтому надо клонировать див.
    let $div = oneOrError($html, ".content:has(.bg-image) div.title").clone(false, false);     // новая универсальное поле имя/городв

    // name
    let name = oneOrError($div, "h1").text().trim();
    if (name == null || name.length < 1)
        throw new Error(`не найдено имя юнита`);

    // city
    // Нижний Новгород (Россия)	строка с городом но там еще куча мусора блять
    // Нижний Новгород (Россия, Южная россия) может и так быть то есть регион
    // привяжемся к ссылке на страну она идет последней
    //let s = $div.find("a:last").map((i, el) => el.previousSibling.nodeValue)[0] as any as string;
    let s = $div.children().detach().end().text().trim() as any as string;
    let last = s.split(/\t/).pop();
    if (last == null)
        throw new Error(`не найден город юнита ${name}`);

    let m = last.match(/^(.*)\(/i);
    if (m == null || m[1] == null || m[1].length <= 1)
        throw new Error(`не найден город юнита ${name}`);

    let city = m[1].trim();

    return [name, city];
}
function oneOrError($item: JQuery, selector: string): JQuery {
    let $one = $item.find(selector);
    if ($one.length != 1)
        throw new Error(`Найдено ${$one.length} элементов вместо 1 для селектора ${selector}`);

    return $one;
}
function extractIntPositive(str: string): number[] | null {
    let m = cleanStr(str).match(/\d+/ig);
    if (m == null)
        return null;

    let n = m.map((val, i, arr) => numberfyOrError(val, -1));
    return n;
}
function cleanStr(str: string): string {
    return str.replace(/[\s\$\%\©]/g, "");
}
function numberfyOrError(str: string, minVal: number = 0, infinity: boolean = false) {
    let n = numberfy(str);
    if (!infinity && (n === Number.POSITIVE_INFINITY || n === Number.NEGATIVE_INFINITY))
        throw new RangeError("Получили бесконечность, что запрещено.");

    if (n <= minVal) // TODO: как то блять неудобно что мин граница не разрешается. удобнее было бы если б она была разрешена
        throw new RangeError("Число должно быть > " + minVal);

    return n;
}
function numberfy(str: string): number {
    // возвращает либо число полученно из строки, либо БЕСКОНЕЧНОСТЬ, либо -1 если не получилось преобразовать.

    if (String(str) === 'Не огр.' ||
        String(str) === 'Unlim.' ||
        String(str) === 'Не обм.' ||
        String(str) === 'N’est pas limité' ||
        String(str) === 'No limitado' ||
        String(str) === '无限' ||
        String(str) === 'Nicht beschr.') {
        return Number.POSITIVE_INFINITY;
    } else {
        // если str будет undef null или что то страшное, то String() превратит в строку после чего парсинг даст NaN
        // не будет эксепшнов
        let n = parseFloat(cleanStr(String(str)));
        return isNaN(n) ? -1 : n;
    }
}
function parseUnitType($html: JQuery): UnitTypes {

    // классы откуда можно дернуть тип юнита грузятся скриптом уже после загрузки страницц
    // и добавляются в дивы. Поэтому берем скрипт который это делает и тащим из него информацию
    let lines = $html.find("div.title script").text().split(/\n/);

    let rx = /\bbody\b.*?\bbg-page-unit-(.*)\b/i;
    let typeStr = "";
    for (let line of lines) {
        let arr = rx.exec(line);
        if (arr != null && arr[1] != null) {
            typeStr = arr[1];
            break;
        }
    }

    if (typeStr.length <= 0)
        throw new Error("Невозможно спарсить тип юнита");

    // некоторый онанизм с конверсией но никак иначе
    let type: UnitTypes = (UnitTypes as any)[typeStr] ? (UnitTypes as any)[typeStr] : UnitTypes.unknown;
    if (type == UnitTypes.unknown)
        throw new Error("Не описан тип юнита " + typeStr);

    return type;
}
function closestByTagName(items: JQuery, tagname: string): JQuery {
    let tag = tagname.toUpperCase();

    let found: Node[] = [];
    for (let i = 0; i < items.length; i++) {
        let node: Node = items[i];
        while ((node = node.parentNode) && node.nodeName != tag) { };

        if (node)
            found.push(node);
    }

    return $(found);
}
function isWindow($html: JQuery, url: string) {
    return url.indexOf("/window/") > 0;
}
function parseUnitTradeHall(html: any, url: string): [number, ITradeHallItem[]] {
    let $html = $(html);

    try {
        let $tbl = isWindow($html, url)
            ? $html.filter("table.list")
            : $html.find("table.list");

        let str = oneOrError($tbl, "div:first").text().trim();
        let filling = numberfyOrError(str, -1);

        let $rows = closestByTagName($html.find("a.popup"), "tr");
        let thItems: ITradeHallItem[] = [];
        $rows.each((i, el) => {
            let $r = $(el);
            let $tds = $r.children("td");

            let cityRepUrl = oneOrError($tds.eq(2), "a").attr("href");
            let historyUrl = oneOrError($r, "a.popup").attr("href");

            // продукт
            // картинка может быть просто от /products/ так и ТМ /products/brand/ типа
            let img = oneOrError($tds.eq(2), "img").attr("src");

            let nums = extractIntPositive(cityRepUrl);
            if (nums == null)
                throw new Error("не получилось извлечь id продукта из ссылки " + cityRepUrl);

            let prodID = nums[0];
            let prodName = $tds.eq(2).attr("title").split("(")[0].trim();

            let product: IProduct = { id: prodID, img: img, name: prodName };

            // склад. может быть -- вместо цены, кач, бренд так что -1 допускается
            let stock: IRetailStock = {
                available: numberfyOrError($tds.eq(5).text(), -1), // 0 или больше всегда должно быть,
                deliver: numberfyOrError($tds.eq(4).text().split("[")[1], -1),
                sold: numberfyOrError(oneOrError($tds.eq(3), "a.popup").text(), -1),
                ordered: numberfyOrError(oneOrError($tds.eq(4), "a").text(), -1),
                product: {
                    price: numberfy($tds.eq(8).text()),
                    quality: numberfy($tds.eq(6).text()),
                    brand: numberfy($tds.eq(7).text())
                }
            };

            // прочее "productData[price][{37181683}]" а не то что вы подумали
            let $input = oneOrError($tds.eq(9), "input");
            let name = $input.attr("name");
            let currentPrice = numberfyOrError($input.val(), -1);
            let dontSale = $tds.eq(9).find("span").text().indexOf("продавать") >= 0;


            // среднегородские цены
            let share = numberfyOrError($tds.eq(10).text(), -1)
            let city: IProductProperties = {
                price: numberfyOrError($tds.eq(11).text()),
                quality: numberfyOrError($tds.eq(12).text()),
                brand: numberfyOrError($tds.eq(13).text(), -1)
            };

            thItems.push({
                product: product,
                stock: stock,
                price: currentPrice,
                city: city,
                share: share,
                historyUrl: historyUrl,
                reportUrl: cityRepUrl,
                name: name,
                dontSale: dontSale
            });
        });

        return [filling, thItems];
    }
    catch (err) {
        throw err;
    }
}
function parseWareSaleNew(html: any, url: string): [JQuery, IDictionary<ISaleWareItem>] {
    let $html = $(html);

    try {
        let $form = isWindow($html, url)
            ? $html.filter("form[name=storageForm]")
            : $html.find("form[name=storageForm]");
        if ($form.length <= 0)
            throw new Error("Не найдена форма.");

        let $tbl = oneOrError($html, "table.grid");
        let $rows = closestByTagName($tbl.find("select[name*='storageData']"), "tr");

        let dict: IDictionary<ISaleWareItem> = {};
        $rows.each((i, el) => {
            let $r = $(el);
            let $tds = $r.children("td");

            // товар
            let prod = parseProduct($tds.eq(2));

            let $price = oneOrError($r, "input.money[name*='[price]']");
            let $policy = oneOrError($r, "select[name*='[constraint]']");
            let $maxQty = oneOrError($r, "input.money[name*='[max_qty]']");
            let maxQty: null | number = numberfy($maxQty.val());
            maxQty = maxQty > 0 ? maxQty : null;

            dict[prod.img] = {
                product: prod,
                stock: parseStock($tds.eq(3)),
                outOrdered: numberfyOrError($tds.eq(4).text(), -1),

                price: numberfyOrError($price.val(), -1),
                salePolicy: $policy.prop("selectedIndex"),
                maxQty: maxQty,

                priceName: $price.attr("name"),
                policyName: $policy.attr("name"),
                maxName: $maxQty.attr("name"),
            }
        });

        return [$form, dict];
    }
    catch (err) {
        //throw new ParseError("sale", url, err);
        throw err;
    }


    function parseProduct($td: JQuery): IProduct {

        // товар
        let $img = oneOrError($td, "img");
        let img = $img.attr("src");
        let name = $img.attr("alt");

        let $a = oneOrError($td, "a");
        let n = extractIntPositive($a.attr("href"));
        if (n == null || n.length > 1)
            throw new Error("не нашли id товара " + img);

        let id = n[0];

        return { name: name, img: img, id: id };
    }

    // если товара нет, то характеристики товара зануляет
    function parseStock($td: JQuery): IStock {
        let $rows = $td.find("tr");

        // могут быть прочерки для товаров которых нет вообще
        let available = numberfy(oneOrError($td, "td:contains(Количество)").next("td").text());
        if (available < 0)
            available = 0;

        return {
            available: available,
            product: {
                brand: 0,
                price: available > 0 ? numberfyOrError(oneOrError($td, "td:contains(Себестоимость)").next("td").text()) : 0,
                quality: available > 0 ? numberfyOrError(oneOrError($td, "td:contains(Качество)").next("td").text()) : 0
            }
        }
    }
}


$(document).ready(() => run_async());