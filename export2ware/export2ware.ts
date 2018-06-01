


$ = jQuery = jQuery.noConflict(true);
$xioDebug = true;
let Realm = getRealmOrError();
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

    // TODO: при запоминании выбранного склада нужно всегда проверять чтобы новая спецуха склада не отличалась от старой
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

// TODO: как часто таскать список всех продуктов???? вопрос
/**
 * Читает с локалстораджа данные по розничным товарам с категориями.
   Если там нет, то тащит и сохраняет на будущее
 */
async function getProdWithCategories_async(): Promise<IDictionaryN<IProductAPI>> {
    let storageKey = buildStoreKey(Realm, ProdCatStoreKeyCode);
    let data = localStorage.getItem(storageKey);

    if (data != null)
        return JSON.parse(LZString.decompress(data));

    // если данных по категориям еще нет, надо их дернуть и записать в хранилище на будущее
    let url = formatStr(UrlApi_tpl.retail_products, Realm);
    let jsonObj = await tryGetJSON_async(url);
    let prods = parseRetailProductsAPI(jsonObj, url);
    localStorage[storageKey] = LZString.compress(JSON.stringify(prods));

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



$(document).ready(() => run_async());