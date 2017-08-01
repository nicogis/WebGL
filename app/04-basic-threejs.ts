import esri = __esri;

// esri
import Map = require("esri/Map");

// esri.geometry
import Point = require("esri/geometry/Point");

// esri.views
import SceneView = require("esri/views/SceneView");

// esri.views.3d
import externalRenderers = require("esri/views/3d/externalRenderers");

// ./support
import * as log from "./support/log";


import THREE = require("app/lib/threejs/three.min.js");


let view: SceneView;

class CustomRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private animations: any[] = [];
  private camera: THREE.PerspectiveCamera;

  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  setup(context: esri.RenderContext) {
    this.initializeRenderer(context);
    this.initializeCamera(context);
    this.initializeScene(context);
  }

  render(context: esri.RenderContext) {
    this.updateCamera(context);
    this.updateLights(context);

    this.renderer.resetGLState();
    this.renderer.render(this.scene, this.camera);

    context.resetWebGLState();

    if (this.animations.length) {
      externalRenderers.requestRender(view);
    }
  }

  add(point: Point) {
    const size = view.scale / 100;
    const geometry = new THREE.BoxBufferGeometry(size, size, size);
    const material = new THREE.MeshPhongMaterial({ color: "#00f" });
    const mesh = new THREE.Mesh(geometry, material);

    this.applyTransformAt(mesh, point);
    mesh.translateZ(size / 2);

    this.scene.add(mesh);
    externalRenderers.requestRender(view);

    log.timeout("Added object");
  }

  private initializeRenderer(context: esri.RenderContext) {
    this.renderer = new THREE.WebGLRenderer({
      context: context.gl,
      premultipliedAlpha: false
    } as any);

    // prevent three.js from clearing the buffers provided by the ArcGIS JS API.
    this.renderer.autoClearDepth = false;
    this.renderer.autoClearStencil = false;
    this.renderer.autoClearColor = false;

    // The ArcGIS JS API renders to custom offscreen buffers, and not to the default framebuffers.
    // We have to inject this bit of code into the three.js runtime in order for it to bind those
    // buffers instead of the default ones.
    const originalSetRenderTarget = this.renderer.setRenderTarget.bind(this.renderer);

    this.renderer.setRenderTarget = (target: any) => {
      originalSetRenderTarget(target);

      if (target == null) {
        context.bindRenderTarget();
      }
    };
  }

  private initializeCamera(context: esri.RenderContext) {
    const camera = context.camera;
    this.camera = new THREE.PerspectiveCamera(camera.fovY, camera.aspect, camera.near, camera.far);
  }

  private initializeScene(context: esri.RenderContext) {
    this.scene = new THREE.Scene();

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.scene.add(this.directionalLight);
  }

  private applyTransformAt(object: THREE.Object3D, location: Point) {
    const transform = new THREE.Matrix4();

    externalRenderers.renderCoordinateTransformAt(view, [location.x, location.y, location.z], location.spatialReference, transform.elements as any);
    transform.decompose(object.position, object.quaternion, object.scale);
  }

  private updateCamera(context: esri.RenderContext) {
    const camera = context.camera;

    this.renderer.setViewport(0, 0, view.width, view.height);

    this.camera.position.set(camera.eye[0], camera.eye[1], camera.eye[2]);
    this.camera.up.set(camera.up[0], camera.up[1], camera.up[2]);
    this.camera.lookAt(new THREE.Vector3(camera.center[0], camera.center[1], camera.center[2]));

    this.camera.projectionMatrix.fromArray(camera.projectionMatrix);
  }

  private updateLights(context: esri.RenderContext) {
    const { direction, diffuse, ambient } = context.sunLight;

    this.directionalLight.position.set(direction[0], direction[1], direction[2]);
    this.directionalLight.intensity = diffuse.intensity;
    this.directionalLight.color = new THREE.Color(diffuse.color[0], diffuse.color[1], diffuse.color[2]);

    this.ambientLight.intensity = ambient.intensity;
    this.ambientLight.color = new THREE.Color(ambient.color[0], ambient.color[1], ambient.color[2]);
  }
}

let renderer: CustomRenderer;

export function initialize() {
  view = new SceneView({
    container: "viewDiv",

    map: new Map({
      basemap: "hybrid",
      ground: "world-elevation"
    }),

    camera: {
      position: [7.572, 46.020, 7148.80],
      heading: 125.93,
      tilt: 65.54
    },

    qualityProfile: "high",

    environment: {
      atmosphere: {
        quality: "high"
      },

      lighting: {
        directShadowsEnabled: true,
        ambientOcclusionEnabled: true
      }
    },

    ui: {
      components: ["compass"]
    } as any
  });



  view.then(() => {
    // Create the custom renderer and add it to the view
    renderer = new CustomRenderer();
    externalRenderers.add(view, renderer);

    view.on("click", (event: any) => {
      if (event.mapPoint) {
        renderer.add(event.mapPoint);
      }
    });
  });

  

}


