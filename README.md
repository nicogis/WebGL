# WebGL samples for ArcGIS API for JavaScript

> [!NOTE]
> These are historical samples originally built with ArcGIS API for JavaScript 4.4 and an older version of Three.js. They are preserved for learning and reference and have not been migrated to the latest ArcGIS Maps SDK for JavaScript.

Most ArcGIS 3D samples in this repository use `externalRenderers`, which is deprecated. For new development, use the `RenderNode` API introduced with ArcGIS Maps SDK for JavaScript 4.29.

## Running the samples

Open the GitHub Pages links below to run the published demos. To run them locally, clone the repository and serve its root directory through a local web server; opening the HTML files directly from the file system may prevent some resources from loading.

The compiled JavaScript files required by the demos are included in the repository, so no build step is needed to run them. `npm install` only restores the historical TypeScript type definitions. Recompiling the TypeScript sources requires a compatible legacy TypeScript toolchain, which is not included.

This repository is a collection of source code and live demonstrations rather than a packaged distribution, so it does not use GitHub Releases.

## Samples

[Swimming pool](https://github.nicogis.it/Demo3D/js/3d/water/)  
Description: Water simulation.

[Sweeper](https://nicogis.github.io/WebGL/index.html)  
Description: Loads a COLLADA sweeper model into an ArcGIS 3D scene using Three.js and `externalRenderers`.

Samples [forked](https://github.com/jkieboom/devsummit-palm-springs-2017) from DS2017:

[Sample 1](https://nicogis.github.io/WebGL/index01.html)  
Description: Visualizes the ECEF coordinate system. See [Earth-centered, Earth-fixed coordinate system](https://en.wikipedia.org/wiki/Earth-centered,_Earth-fixed_coordinate_system) for details.

[Sample 2](https://nicogis.github.io/WebGL/index02.html)  
Description: Camera and lighting.

[Sample 3](https://nicogis.github.io/WebGL/index03.html)  
Description: Precision.

[Sample 4](https://nicogis.github.io/WebGL/index04.html)  
Description: Adds a Three.js box to an ArcGIS 3D scene.

[Sample 5](https://nicogis.github.io/WebGL/index05.html)  
Description: Animation.

[Sample 6](https://nicogis.github.io/WebGL/index06.html)  
Description: Video texture. Hold the CTRL key and drag to create a textured box, then click it to start the video.

[Animated Flow](https://github.com/Esri/animated-flow-ts)  
Description: Flow.

[Sample 8](https://nicogis.github.io/WebGL/Sweeper.html)  
Description: Loads the sweeper OBJ/MTL model in a standalone Three.js scene without ArcGIS.

[Tectonic](https://jkieboom.github.io/devsummit-palm-springs-2018/demos/tectonic/)  
Description: Tectonic plates (DevSummit 2018).

[Animated windmills](https://developers.arcgis.com/javascript/latest/sample-code/custom-render-node-windmills/)  
Description: Custom RenderNode — Animated Windmills.

[Realistic water visualization in 3D](https://developers.arcgis.com/javascript/latest/sample-code/visualization-realistic-water/)  
Description: Realistic water visualization in 3D.

[Renderer Skeleton](https://nicogis.github.io/externalRendererSkeleton/)  
Description: Renderer Skeleton.

[Esri's Applications Prototype Lab](https://maps.esri.com/portal/WebApps/index.html)  
Description: Samples from Esri's Applications Prototype Lab.

[Demo 3D (old)](https://github.com/nicogis/Demo3D)  
Description: Older 3D samples.

## Useful links

- [External Renderer with ArcGIS API for JavaScript — deprecated](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-3d-externalRenderers.html)
- [RenderNode — available since ArcGIS Maps SDK for JavaScript 4.29](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-3d-webgl-RenderNode.html)
- [Three.js](https://threejs.org/)
- [WebGL Fundamentals](https://webglfundamentals.org/)
