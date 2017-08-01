define(["require", "exports", "esri/Map", "esri/views/MapView"], function (require, exports, Map, MapView) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function createFullscreen(view) {
        const fullscreen = document.createElement("div");
        fullscreen.classList.add("esri-button", "esri-widget-button", "esri-interactive");
        const span = document.createElement("span");
        span.classList.add("esri-icon", "esri-icon-zoom-out-fixed");
        fullscreen.appendChild(span);
        view.ui.add(fullscreen, "top-left");
        fullscreen.addEventListener("click", function () {
            parent.postMessage({ type: "fullscreen" }, "*");
        });
    }
    exports.createFullscreen = createFullscreen;
    function createOverviewMap(view) {
        const div = document.createElement("div");
        div.setAttribute("id", "overviewDiv");
        view.container.appendChild(div);
        const mapView = new MapView({
            map: new Map({
                basemap: "streets-night-vector"
            }),
            container: div,
            ui: {
                components: []
            },
            constraints: {
                snapToZoom: false
            }
        });
        const handle = view.watch("extent", (extent) => {
            mapView.extent = extent;
        });
        return {
            view: mapView,
            remove: () => {
                handle.remove();
                mapView.container = null;
                mapView.destroy();
                if (div.parentElement) {
                    div.parentElement.removeChild(div);
                }
            }
        };
    }
    exports.createOverviewMap = createOverviewMap;
    const addElementDiv = document.createElement("div");
    function add(view, html, eventHandlers) {
        addElementDiv.innerHTML = html;
        const elem = addElementDiv.children[0];
        addElementDiv.innerHTML = "";
        elem.classList.add("text-on-view");
        view.ui.add(elem, "top-left");
        if (eventHandlers) {
            for (const eventName in eventHandlers) {
                elem.addEventListener(eventName, eventHandlers[eventName]);
            }
        }
        return elem;
    }
    exports.add = add;
});
//# sourceMappingURL=widgets.js.map