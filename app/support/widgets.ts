import esri = __esri;

// esri
import Map = require("esri/Map");

// esri.views
import MapView = require("esri/views/MapView");

export function createFullscreen(view: esri.SceneView) {
  const fullscreen = document.createElement("div");
  fullscreen.classList.add("esri-button", "esri-widget-button", "esri-interactive");

  const span = document.createElement("span");
  span.classList.add("esri-icon", "esri-icon-zoom-out-fixed");

  fullscreen.appendChild(span);
  view.ui.add(fullscreen, "top-left");

  fullscreen.addEventListener("click", function() {
    parent.postMessage({ type: "fullscreen" }, "*");
  });
}

export function createOverviewMap(view: esri.SceneView) {
  const div = document.createElement("div");
  div.setAttribute("id", "overviewDiv");

  (view.container as any).appendChild(div);

  const mapView = new MapView({
    map: new Map({
      basemap: "streets-night-vector"
    }),

    container: div as any,

    ui: {
      components: []
    } as any,

    constraints: {
      snapToZoom: false
    }
  });

  const handle = view.watch("extent", (extent: esri.Extent) => {
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

const addElementDiv = document.createElement("div");

export function add(view: esri.SceneView, html: string, eventHandlers?: { [key: string]: (event: any) => void }): HTMLElement {
  addElementDiv.innerHTML = html;
  const elem = addElementDiv.children[0] as HTMLElement;
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
