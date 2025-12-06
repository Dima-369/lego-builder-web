"use strict";

LDR.InstructionsManager = function (
  modelUrl,
  modelID,
  modelColor,
  mainImage,
  refreshCache,
  baseURL,
  stepFromParameters,
  options,
  showParts,
) {
  let startTime = new Date();
  let self = this;
  this.showParts = showParts;
  options = options || {};
  this.stepEditor;
  this.showEditor = options.showEditor === true;
  this.modelID = modelID;
  this.modelColor = modelColor;
  this.refreshCache = refreshCache || function () {};
  this.baseURL = baseURL;
  this.pliMaxWidthPercentage = options.hasOwnProperty("pliMaxWidthPercentage")
    ? options.pliMaxWidthPercentage
    : 40;
  this.pliMaxHeightPercentage = options.hasOwnProperty("pliMaxHeightPercentage")
    ? options.pliMaxHeightPercentage
    : 35;
  this.animateUIElements = options.hasOwnProperty("animateUIElements")
    ? options.animateUIElements
    : false;

  LDR.Colors.canBeOld = true;

  this.scene = new THREE.Scene(); // To add stuff to
  //this.scene.add(new THREE.AxesHelper(50));

  this.defaultZoom = 1; // Will be overwritten.
  this.currentStep = 1; // Shown current step.
  this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000000); // Orthographics for LEGO

  let pixelRatio = window.devicePixelRatio || 1;
  this.canvas = document.getElementById("main_canvas");
  this.renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: this.canvas,
    logarithmicDepthBuffer: false,
    alpha: true,
  });
  this.renderer.setPixelRatio(pixelRatio);
  this.secondaryCanvas = document.getElementById("secondary_canvas");
  this.secondaryRenderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: this.secondaryCanvas,
    alpha: true,
  });
  this.secondaryRenderer.setPixelRatio(pixelRatio);

  let canvasHolder = document.getElementById("main_canvas_holder");
  let actions = {
    prevStep: () => self.prevStep(),
    nextStep: () => self.nextStep(),
    zoomIn: () => self.zoomIn(),
    zoomOut: () => self.zoomOut(),
    resetCameraPosition: () => self.resetCameraPosition(),
    closeInstructions: () => {
      window.location.href = "index.html";
    },
    clickProgressBar: (percent) => {
      if (self.stepHandler) {
        let total = self.stepHandler.totalNumberOfSteps;
        let target = Math.round(percent * (total - 1)) + 1;
        // Ensure bounds
        target = Math.max(1, Math.min(total, target));
        if (self.currentStep !== target) {
          self.showParts = false;
          self.goToStep(target, true);
        }
      }
    },
    toggleEditor: () =>
      (window.location =
        options.editorToggleLocation + "&step=" + self.currentStep),
  };
  this.ldrButtons = new LDR.Buttons(actions, canvasHolder, options);
  this.controls = new THREE.OrbitControls(this.camera, this.canvas);
  this.controls.noTriggerSize = 0.1;
  this.controls.screenSpacePanning = true;
  this.controls.enablePan = false;
  this.controls.addEventListener("change", () => self.render());

  this.topButtonsHeight = 0; // Changed from 100 to 0 as top bar is removed
  this.resetCameraPosition();

  this.pulseId = null; // Initialize pulseId for animation loop management

  window.addEventListener("resize", () => self.onWindowResize(), false);

  this.adPeek = options.hasOwnProperty("adPeek") ? options.adPeek : 0;

  // PLI either from storage or params:
  // Force pliW/H to 0 initially if not showing parts, essentially
  let [allW, allH] = LDR.getScreenSize();
  this.storagePLIW = localStorage.getItem("pliW");
  if (this.storagePLIW !== null && this.storagePLIW >= 0) {
    this.pliW = this.storagePLIW;
  } else {
    this.pliW = (allW * this.pliMaxWidthPercentage) / 100;
  }
  let clampW = () =>
    (self.pliW = self.storagePLIW =
      Math.min(Math.max(self.pliW, 0), allW - 70));
  clampW();

  this.storagePLIH = localStorage.getItem("pliH");
  if (this.storagePLIH !== null && this.storagePLIH >= 0) {
    this.pliH = this.storagePLIH;
  } else {
    this.pliH = ((allH - this.adPeek) * this.pliMaxHeightPercentage) / 100;
  }
  let clampH = () =>
    (self.pliH = self.storagePLIH =
      Math.min(Math.max(self.pliH, 0), allH - self.adPeek - 50));
  clampH();

  this.lastRefresh = new Date();

  this.currentRotationMatrix = new THREE.Matrix4();
  this.currentRotationMatrix.set(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  this.defaultMatrix = new THREE.Matrix4();
  this.defaultMatrix.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

  this.ldrLoader; // To be set once model is loaded.
  this.stepHandler; // Set in 'onPartsRetrieved'
  this.pliElement = document.getElementById("pli");
  this.emptyElement = document.getElementById("empty_step");
  this.pliBuilder; // Set in 'onPartsRetrieved'
  this.outlinePass = null; // Set in onWindowResize
  this.glowPasses = []; // Set in onWindowResize
  this.composer = null; // Set in onWindowResize
  this.resetSelectedObjects();

  this.baseObject = new THREE.Group();
  this.opaqueObject = new THREE.Group();
  this.sixteenObject = new THREE.Group();
  this.transObject = new THREE.Group();
  this.baseObject.add(this.opaqueObject); // Draw non-trans before trans.
  this.baseObject.add(this.sixteenObject);
  this.baseObject.add(this.transObject);
  this.scene.add(this.baseObject);
  this.pliPreviewer = new LDR.PliPreviewer(
    modelID,
    this.secondaryCanvas,
    this.secondaryRenderer,
  );

  this.showPLI = false;
  this.hovered = false;

  // Variables for realignModel:
  this.oldMultiplier = 1;
  this.currentMultiplier = 1;
  this.currentRotation = false;
  this.initialConfiguration = true;

  this.accHelper;
  this.helper;

  // Make ldrButtons catch arrow keys left/right:
  function handleKeyDown(e) {
    e = e || window.event;
    if (e.altKey) {
      // Don't handle key events when ALT is pressed, as they indicate page shift overwrite!
      return;
    }
    if (e.keyCode === 13) {
      // ENTER
      let stepToGoTo = parseInt(self.ldrButtons.stepInput.value);
      self.goToStep(stepToGoTo);
    } else if (e.keyCode === 37) {
      // Left:
      self.prevStep();
    } else if (e.keyCode === 39) {
      // Right:
      self.nextStep();
    } else if (e.keyCode === 27) {
      // ESC closes preview.
      self.hidePliPreview();
    } else if (self.stepEditor && self.showEditor) {
      // Send rest to editor if available:
      self.stepEditor.handleKeyDown(e);
    }
  }
  document.onkeydown = handleKeyDown;

  let onPartsLoadedCalled = true; // Default: Assume parser calls onPartsLoaded
  let onLoadCalled = false;

  let onLoad = function () {
    if (!onPartsLoadedCalled) {
      self.ldrLoader.onPartsLoaded();
      onPartsLoadedCalled = true;
    }
    if (onLoadCalled) {
      console.warn("onLoad called multiple times!");
      return;
    }
    onLoadCalled = true;

    console.log("Done loading at " + (new Date() - startTime) + "ms.");

    // Ensure replaced parts are substituted:
    self.ldrLoader.substituteReplacementParts();

    // After part substitution, set back-references so parts can be cleaned up:
    self.ldrLoader.setReferencedFrom();

    // Find what should be built for first step:
    let mainModel = self.ldrLoader.mainModel;
    let origo = new THREE.Vector3();
    let inv = new THREE.Matrix3();
    inv.set(1, 0, 0, 0, 1, 0, 0, 0, 1); // Invert Y-axis

    let pd = new THREE.LDRPartDescription(
      self.modelColor,
      origo,
      inv,
      mainModel,
      false,
    );

    self.pliBuilder = new LDR.PLIBuilder(
      self.ldrLoader,
      self.showEditor,
      mainModel,
      document.getElementById("pli"),
      self.secondaryRenderer,
    );
    self.stepHandler = new LDR.StepHandler(self, [pd], true);
    self.stepHandler.nextStep(false);

    self.realignModel(0);
    self.updateUIComponents(false);
    self.render(); // Updates background color.

    console.log("Render done after " + (new Date() - startTime) + "ms.");

    // Go to step indicated by parameter:
    if (stepFromParameters > 1) {
      self.stepHandler.moveTo(stepFromParameters);
      self.handleStepsWalked();
    }

    // Enable pli preview:
    self.pliPreviewer.enableControls();

    // Enable editor:
    if (self.showEditor) {
      function removeGeometries() {
        self.ldrLoader.applyOnPartTypes((pt) => {
          if (!pt.isPart) {
            pt.geometry = null;
          }
        });
      }
      function onEditDone() {
        self.ignoreViewPortUpdate = true;
        self.handleStepsWalked();
        self.ignoreViewPortUpdate = false;
      }

      self.stepEditor = new LDR.StepEditor(
        self.ldrLoader,
        self.stepHandler,
        self.pliBuilder,
        removeGeometries,
        onEditDone,
        self.modelID,
      );
      self.stepEditor.createGuiComponents(document.getElementById("editor"));
      $("#editor").show();
    }
  };

  let onInstructionsLoaded = function (ok, parts) {
    if (ok) {
      onPartsLoadedCalled = false; // Because instructions could be fetched from storage
      if (parts.length === 0) {
        onLoad(); // Done!
      } else {
        self.ldrLoader.loadMultiple(parts);
      }
    } else {
      // Not loaded from storage. Proceed with normal loading:
      self.ldrLoader.load(modelUrl);
    }
  };
  let onStorageReady = function () {
    if (LDR.Options) {
      LDR.Studs.makeGenerators(
        "",
        LDR.Options.studHighContrast,
        LDR.Options.studLogo,
      );
    }
    self.ldrLoader = new THREE.LDRLoader(onLoad, self.storage, options);
    if (self.storage) {
      self.storage.retrieveInstructionsFromStorage(
        self.ldrLoader,
        onInstructionsLoaded,
      );
    } else {
      onInstructionsLoaded(false);
    }
  };

  // Set up PLI interactions:
  let pli = document.getElementById("pli");
  pli.addEventListener("click", (e) => self.onPLIClick(e));
  pli.addEventListener("mousemove", (e) => self.onPLIMove(e));
  pli.addEventListener("mouseover", (e) => self.onPLIMove(e));
  pli.addEventListener("mouseout", () => self.onPLIMove(false));

  if (options.setUpOptions && LDR.Options) {
    this.setUpOptions();
  }
  this.onWindowResize();
  if (LDR.STORAGE) {
    this.storage = new LDR.STORAGE(onStorageReady);
  } else {
    onStorageReady();
  }

  // Set up PLI interactions:
  let p = document.getElementById("instructions_decorations");
  let x, y, pliW, pliH;
  let mouseStart = (e) => {
    x = e.clientX;
    y = e.clientY;
    pliH = self.pliH;
    pliW = self.pliW;
  };
  let touchStart = (e) => {
    if (e.touches.length > 0) {
      x = e.touches[0].pageX;
      y = e.touches[0].pageY;
      pliH = self.pliH;
      pliW = self.pliW;
    }
  };
  let stop = (e) => {
    self.onWindowResize();
  };

  // Start:
  p.addEventListener("mousedown", mouseStart);
  p.addEventListener("touchstart", touchStart);

  // Stop:
  p.addEventListener("mouseup", stop);
  p.addEventListener("touchend", stop);

  // Move:
  function resize(x2, y2) {
    return false;
  }
  p.addEventListener("mousemove", (e) => resize(e.clientX, e.clientY));
  p.addEventListener("touchmove", (e) => {
    if (
      e.touches.length > 0 &&
      resize(e.touches[0].pageX, e.touches[0].pageY)
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
};

LDR.InstructionsManager.prototype.updateRotator = function (zoom) {
  let rotator = document.getElementById("rotator");
  let showRotator = this.stepHandler.getShowRotatorForCurrentStep();
  if (showRotator) {
    rotator.style.visibility = "visible";
    let rotatorAnimation = document.getElementById("rotator_animation");
    if (this.animateUIElements) {
      rotatorAnimation.beginElement();
    }
  } else {
    rotator.style.visibility = "hidden";
  }
};

LDR.InstructionsManager.prototype.updateMultiplier = function (zoom) {
  let changes = this.oldMultiplier !== this.currentMultiplier;
  if (!changes) {
    return;
  }
  let multiplier = $("#multiplier");
  if (this.currentMultiplier === 1) {
    multiplier[0].style.visibility = "hidden";
    multiplier[0].innerHTML = "";
  } else {
    multiplier[0].style.visibility = "visible";
    multiplier[0].innerHTML = "x" + this.currentMultiplier;
    if (this.animateUIElements) {
      multiplier[0].style["font-size"] = "20vw";
      setTimeout(() => multiplier.animate({ fontSize: "8vw" }, 200), 100);
    } else {
      multiplier[0].style["font-size"] = "8vw";
    }
  }
  this.oldMultiplier = this.currentMultiplier;
};

LDR.InstructionsManager.prototype.updateCameraZoom = function (zoom) {
  zoom = zoom || this.defaultZoom;
  this.camera.zoom = zoom;
  this.camera.updateProjectionMatrix();
};

LDR.InstructionsManager.prototype.resetSelectedObjects = function () {
  this.selectedObjects = [];
  this.inSelectedObjects = {};
};

LDR.InstructionsManager.prototype.addSelectedObject = function (idx, a) {
  this.selectedObjects.push(...a);
  this.inSelectedObjects[idx] = true;
};

LDR.InstructionsManager.prototype.hasSelectedObject = function (idx) {
  return this.inSelectedObjects.hasOwnProperty(idx);
};

LDR.InstructionsManager.prototype.render = function () {
  // Prevent stacking animation loops if render is triggered by mouse events
  if (this.pulseId) {
    cancelAnimationFrame(this.pulseId);
    this.pulseId = null;
  }

  if (this.composer) {
    if (this.outlinePass !== null) {
      this.outlinePass.selectedObjects = this.selectedObjects;
    }
    this.composer.render();
  } else {
    this.renderer.render(this.scene, this.camera);
  }

  // If pulsing is active, keep the loop going
  if (this.outlinePass && this.outlinePass.pulsePeriod > 0) {
    this.pulseId = requestAnimationFrame(() => this.render());
  }

  // Toggle Reset Camera Button based on whether camera is in default position
  if (
    this.ldrButtons &&
    this.ldrButtons.resetCameraButton &&
    this.defaultCameraPos
  ) {
    const EPS_POS = 0.5; // Tolerance for position floating point comparison
    const EPS_ZOOM = 0.005; // Tolerance for zoom

    const isDefaultPos =
      this.camera.position.distanceTo(this.defaultCameraPos) < EPS_POS;
    const isDefaultTarget = this.controls.target.lengthSq() < EPS_POS; // Target should be (0,0,0)
    const isDefaultZoom =
      Math.abs(this.camera.zoom - this.defaultZoom) < EPS_ZOOM;

    // If at default, hide (display: none), otherwise remove inline style (allow CSS to show it)
    this.ldrButtons.resetCameraButton.style.display =
      isDefaultPos && isDefaultTarget && isDefaultZoom ? "none" : "";
  }
};

LDR.InstructionsManager.prototype.setBackgroundColor = function (c) {
  this.scene.background = null;
  // Optional: If you still want the HTML body color to change based on step depth, keep the next line.
  // If you want a fixed gradient for the whole experience, comment the next line out:
  // document.body.style.backgroundColor = '#' + c;
};

LDR.InstructionsManager.prototype.buildOutlinePass = function (w, h) {
  this.outlinePass = new OutlinePass(
    new THREE.Vector2(w, h),
    this.scene,
    this.camera,
    this.selectedObjects,
  );
  this.outlinePass.edgeStrength = 20;
};

LDR.InstructionsManager.prototype.onWindowResize = function (force, instant) {
  this.topButtonsHeight = 0; // Changed from getting element height

  let [w, h] = LDR.getScreenSize();
  h -= this.adPeek;

  // Calculate physical buffer size to match renderer
  var pixelRatio = this.renderer.getPixelRatio();
  let wRes = Math.floor(w * pixelRatio);
  let hRes = Math.floor(h * pixelRatio);

  // Check against physical size to prevent unnecessary resizing
  if (force || this.canvas.width !== wRes || this.canvas.height !== hRes) {
    this.renderer.setSize(w, h, true);
    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    let any = false;
    if (LDR.Options && LDR.Options.showOldColors <= 1) {
      any = true;
      this.buildOutlinePass(wRes, hRes); // Use physical resolution
      this.composer.addPass(this.outlinePass);
    } else {
      this.outlinePass = null;
    }

    // FXAA Pass to restore antialiazing:
    var fxaaPass = new THREE.ShaderPass(new THREE.FXAAShader());
    var uniforms = fxaaPass.material.uniforms;
    uniforms["resolution"].value.x = 1 / (window.innerWidth * pixelRatio);
    uniforms["resolution"].value.y = 1 / (window.innerHeight * pixelRatio);
    this.composer.addPass(fxaaPass);

    if (this.stepHandler) {
      // Attach glow for all mesh collectors up until this step:
      let map = {};
      this.stepHandler.getGlowObjects(map);

      if (
        LDR.attachGlowPassesForObjects(
          map,
          wRes, // Use physical resolution
          hRes, // Use physical resolution
          this.scene,
          this.camera,
          this.composer,
        )
      ) {
        any = true;
      }
    }

    if (!any) {
      this.composer = null;
    }
  }
  this.camera.left = -this.canvas.clientWidth * 0.95;
  this.camera.right = this.canvas.clientWidth * 0.95;
  this.camera.top = this.canvas.clientHeight * 0.95;
  this.camera.bottom = -this.canvas.clientHeight * 0.95;

  this.updateViewPort();
  this.updateCameraZoom();
  if (this.stepHandler) {
    this.realignModel(0, undefined, undefined, instant);
    this.updateUIComponents(false);
  }
};

LDR.InstructionsManager.prototype.resetCameraPosition = function () {
  let size = 1000;
  if (this.stepHandler) {
    this.stepHandler.getAccumulatedBounds().getSize(LDR.tmpSize);
    size = LDR.tmpSize.length();
  }

  const targetPos = new THREE.Vector3(10 * size, 7 * size, 10 * size);
  const targetTarget = new THREE.Vector3(0, 0, 0);
  const targetZoom = this.defaultZoom;

  const startPos = this.camera.position.clone();
  const startTarget = this.controls.target.clone();
  const startZoom = this.camera.zoom;

  const duration = 900;
  const startTime = performance.now();
  const self = this;

  function animate() {
    const now = performance.now();
    const progress = Math.min((now - startTime) / duration, 1);
    const t = 1 - Math.pow(1 - progress, 3); // Cubic ease-out

    self.camera.position.lerpVectors(startPos, targetPos, t);
    self.controls.target.lerpVectors(startTarget, targetTarget, t);
    self.camera.zoom = startZoom + (targetZoom - startZoom) * t;

    self.camera.lookAt(self.controls.target);
    self.camera.updateProjectionMatrix();
    self.render();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      self.controls.reset();
      self.updateCameraZoom();
      self.updateViewPort();
      self.camera.lookAt(new THREE.Vector3());
      self.camera.updateProjectionMatrix();
      self.updateViewPort();
      self.render();
    }
  }
  animate();
};

LDR.InstructionsManager.prototype.zoomIn = function () {
  this.controls.dollyIn(1.2);
  this.render();
};

LDR.InstructionsManager.prototype.zoomOut = function () {
  this.controls.dollyOut(1.2);
  this.render();
};

LDR.InstructionsManager.prototype.updateUIComponents = function (force) {
  if (!this.stepHandler) {
    return; // Not ready.
  }

  // Toggle Visibility based on showParts
  const pliContainer = document.getElementById("pli_container");
  const mainCanvas = document.getElementById("main_canvas");

  if (this.showParts) {
    document.body.classList.add("show-parts");
    // Show Parts Mode: Fullscreen PLI
    // Note: We do NOT hide mainCanvas (display: none) here. Keeping it block ensures
    // clientWidth/Height are always available for camera calculations in realignModel().
    // The pliContainer covers it via z-index and background color.
    if (pliContainer) {
      pliContainer.style.display = "block";
      pliContainer.style.position = "fixed";
      pliContainer.style.top = "0";
      pliContainer.style.left = "0";
      pliContainer.style.width = "100vw";
      pliContainer.style.height = "100vh";
      pliContainer.style.zIndex = "5"; // Below buttons (10)
      pliContainer.style.border = "none";
      pliContainer.style.background = "#fff"; // White background for parts page
    }
    // Hide decorations that belong to model view
    document.getElementById("instructions_decorations").style.pointerEvents =
      "none"; // Click through
    // But ensure pli container clicks work
    if (pliContainer) pliContainer.style.pointerEvents = "auto";

    // Hide specific decorations usually overlaying model
    document.getElementById("multiplier").style.display = "none";
    document.getElementById("rotator").style.display = "none";
  } else {
    document.body.classList.remove("show-parts");
    // Show Model Mode
    if (pliContainer) {
      pliContainer.style.display = "none";
      pliContainer.style.position = "relative";
      pliContainer.style.top = "auto";
      pliContainer.style.left = "auto";
      pliContainer.style.width = "auto";
      pliContainer.style.height = "auto";
      pliContainer.style.zIndex = "auto";
      pliContainer.style.border = "2px solid black";
      pliContainer.style.background = "white";
    }

    document.getElementById("instructions_decorations").style.pointerEvents =
      "auto";
    document.getElementById("multiplier").style.display = "inline";
    document.getElementById("rotator").style.display = "inline";
  }

  this.currentMultiplier = this.stepHandler.getMultiplierOfCurrentStep();
  this.updateMultiplier();
  this.updateRotator();
  this.setBackgroundColor(this.stepHandler.getBackgroundColorOfCurrentStep());
  let showPrev = !(this.stepHandler.isAtFirstStep() && this.showParts);
  let showNext = !(this.stepHandler.isAtLastStep() && !this.showParts);
  this.ldrButtons.setVisibility(showPrev, showNext);

  // Update Progress Bar Dot Position
  if (this.stepHandler && this.ldrButtons.progressDot) {
    let total = this.stepHandler.totalNumberOfSteps;
    // currentStep is 1-based index usually, total is count.
    // If currentStep is 1, pct is 0%. If currentStep is total, pct is 100%.
    let pct = 0;
    if (total > 1) {
      pct = ((this.currentStep - 1) / (total - 1)) * 100;
    }
    this.ldrButtons.progressDot.style.left = pct + "%";

    if (this.ldrButtons.progressLine) {
      this.ldrButtons.progressLine.style.background = `linear-gradient(to right, #fdc700 ${pct}%, white ${pct}%)`;
    }
  }

  this.updatePLI(force);
  this.updateViewPort();
  this.updateCameraZoom();

  this.render();
  this.stepEditor && this.stepEditor.updateCurrentStep();
};

LDR.InstructionsManager.prototype.updatePLI = function (
  force = false,
  quick = false,
) {
  let step = this.stepHandler.getCurrentStep();

  this.showPLI = this.showEditor || step.containsPartSubModels(this.ldrLoader);
  let e = this.pliElement;
  this.emptyElement.style.display =
    !this.showEditor ||
    this.showPLI ||
    step.containsNonPartSubModels(this.ldrLoader)
      ? "none"
      : "inline-block";

  if (!this.showPLI) {
    e.style.display = "none";
    return;
  }
  e.style.display = "inline-block";

  let [maxWidth, maxHeight] = LDR.getScreenSize();
  maxWidth *= 0.95; //e.offsetLeft + 20;
  maxHeight -= this.adPeek; // Removed 130 for the top buttons since there is no top bar

  if (this.fillHeight()) {
    let w = this.pliW;
    let h = maxHeight;
    if (quick) {
      this.pliBuilder.canvas.width = w * window.devicePixelRatio;
      this.pliBuilder.canvas.style.width = w + "px";
    } else {
      this.pliBuilder.drawPLIForStep(true, step, w, h, force);
    }
  } else {
    let w = maxWidth;
    let h = this.pliH;
    if (quick) {
      this.pliBuilder.canvas.height = h * window.devicePixelRatio;
      this.pliBuilder.canvas.style.height = h + "px";
    } else {
      this.pliBuilder.drawPLIForStep(false, step, w, h, force);
    }
  }
};

LDR.InstructionsManager.prototype.fillHeight = function () {
  let [w, h] = LDR.getScreenSize();
  return w > h;
};

LDR.tmpSize = new THREE.Vector3();
LDR.InstructionsManager.prototype.updateViewPort = function (overwriteSize) {
  if (this.ignoreViewPortUpdate) {
    return; // Editor change
  }

  let W = this.canvas.clientWidth * 0.95;
  let H = this.canvas.clientHeight * 0.95;

  // Set camera position and far plane according to current step bounds:
  let size = 1000;
  if (this.stepHandler) {
    this.stepHandler.getAccumulatedBounds().getSize(LDR.tmpSize);
    size = LDR.tmpSize.length();
  }

  this.camera.position.set(10 * size, 7 * size, 10 * size);
  this.defaultCameraPos = this.camera.position.clone(); // Store default for reset button logic
  this.camera.far = 2 * 15.7797 * size; // Roughly double the camera distance, so that we can see to the other side.

  let dx = 0;
  let dy = this.topButtonsHeight; // Now 0

  if (!overwriteSize && !this.showPLI) {
    // No move logic for PLI, but we still apply bottom offset below
  } else if (this.fillHeight()) {
    dx += overwriteSize ? overwriteSize[0] : this.pliW;
  } else {
    dy += overwriteSize ? overwriteSize[1] : this.pliH;
  }

  // Shift the model up by ~12% of the viewport height to clear the bottom progress bar.
  // Positive Y offset in setViewOffset moves the view window down -> Model moves Up.
  let modelLift = H * 0.06;

  this.camera.clearViewOffset();
  this.camera.setViewOffset(W, H, -dx / 2, -dy / 2 + modelLift, W, H);
  this.camera.updateProjectionMatrix();
  this.controls.update();
};

LDR.InstructionsManager.prototype.realignModel = function (
  stepDiff,
  onRotated,
  onDone,
  instant,
) {
  let self = this;
  let oldRotationMatrix = this.currentRotationMatrix;
  let oldPosition = new THREE.Vector3();
  oldPosition.copy(this.baseObject.position);
  let oldPLIW = this.showPLI ? this.pliW : 0;
  let oldPLIH = this.showPLI ? this.pliH : 0;

  let oldLevel = this.stepHandler.getLevelOfCurrentStep();
  let newLevel = oldLevel;
  let goBack = function () {}; // Used for single steps
  if (stepDiff === 1 && this.stepHandler.nextStep(true)) {
    goBack = function () {
      newLevel = self.stepHandler.getLevelOfCurrentStep();
      self.stepHandler.prevStep(true);
    };
  } else if (stepDiff === -1 && this.stepHandler.prevStep(true)) {
    goBack = function () {
      newLevel = self.stepHandler.getLevelOfCurrentStep();
      self.stepHandler.nextStep(true);
    };
  }

  let [viewPortWidth, viewPortHeight] = LDR.getScreenSize();
  viewPortHeight -= this.adPeek;
  if (this.pliH > 0) {
    // Adjust for pli.
    if (this.fillHeight()) {
      viewPortWidth -= this.pliW;
    } else {
      viewPortHeight -= this.pliH;
    }
  }

  let useAccumulatedBounds = true;
  let b = this.stepHandler.getAccumulatedBounds();

  let size = b.min.distanceTo(b.max);
  let viewPortSize =
    0.75 *
    Math.sqrt(viewPortWidth * viewPortWidth + viewPortHeight * viewPortHeight);

  if (size > viewPortSize) {
    useAccumulatedBounds = false;
    b = this.stepHandler.getBounds();
    size = b.min.distanceTo(b.max);
    if (size < viewPortSize) {
      // Zoom a bit out as just the step is a bit too small.
      let bDiff = new THREE.Vector3();
      bDiff.subVectors(b.max, b.min); // b.max-b.min
      bDiff.multiplyScalar(0.1 * (viewPortSize / size - 1));
      b.max.add(bDiff);
      b.min.sub(bDiff);
      size = viewPortSize;
    }
  }
  let newPosition;
  [newPosition, this.currentRotationMatrix] =
    this.stepHandler.computeCameraPositionRotation(
      this.defaultMatrix,
      this.currentRotationMatrix,
      useAccumulatedBounds,
    );

  // Check if specific rotation rules exist for this model
  if (LDR.ModelRotations && LDR.ModelRotations[this.modelID]) {
    const rules = LDR.ModelRotations[this.modelID];

    // Get current step number
    const visibleStepNumber = this.stepHandler.getCurrentStepIndex();

    let extraRotation = null;

    if (
      rules.stepsRotated90 &&
      rules.stepsRotated90.includes(visibleStepNumber)
    ) {
      extraRotation = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    } else if (
      rules.stepsRotated180 &&
      rules.stepsRotated180.includes(visibleStepNumber)
    ) {
      extraRotation = new THREE.Matrix4().makeRotationY(Math.PI);
    } else if (
      rules.stepsRotated270 &&
      rules.stepsRotated270.includes(visibleStepNumber)
    ) {
      extraRotation = new THREE.Matrix4().makeRotationY((3 * Math.PI) / 2);
    }

    if (extraRotation) {
      // 1. Apply the rotation to the matrix
      this.currentRotationMatrix.multiply(extraRotation);

      // 2. RECALCULATE CENTER POSITION
      // Instead of rotating the old position vector, we take the raw bounding box center,
      // transform it by our NEW rotation matrix, and negate it.
      // This guarantees the model is mathematically centered at (0,0,0) regardless of rotation.

      let center = new THREE.Vector3();
      // 'b' is the bounding box variable defined earlier in this function (around line 515)
      b.getCenter(center);

      center.applyMatrix4(this.currentRotationMatrix);
      newPosition.copy(center).negate();
    }
  }

  // Find actual screen bounds:
  this.baseObject.setRotationFromMatrix(this.currentRotationMatrix);
  this.baseObject.updateMatrixWorld(true);
  let measurer = new LDR.Measurer(this.camera);
  let [dx, dy] = measurer.measure(b, this.baseObject.matrixWorld);

  this.updatePLI(false);
  let newPLIW = this.showPLI ? this.pliW : 0;
  let newPLIH = this.showPLI ? this.pliH : 0;

  goBack();

  let rotationChanges = !this.currentRotationMatrix.equals(oldRotationMatrix);
  let ignorePos = new THREE.Vector3(); // Ignore
  let newRot = new THREE.Quaternion();
  let ignoreScale = new THREE.Vector3(); // Ignore
  this.currentRotationMatrix.decompose(ignorePos, newRot, ignoreScale);

  let positionChanges =
    !oldPosition.equals(newPosition) ||
    oldPLIW !== newPLIW ||
    oldPLIH !== newPLIH;

  let oldDefaultZoom = this.defaultZoom;
  [viewPortWidth, viewPortHeight] = LDR.getScreenSize();
  viewPortHeight -= this.adPeek; // - this.topButtonsHeight; // Since topButtonsHeight is now 0, removed it
  if (this.fillHeight()) {
    viewPortWidth -= newPLIW;
  } else {
    viewPortHeight -= newPLIH;
  }
  let [allW, allH] = LDR.getScreenSize();
  let scaleX = (allW / viewPortWidth) * 1.1; // 1.1 to scale down a bit
  let scaleY = ((allH - this.adPeek) / viewPortHeight) * 1.1;
  if (dx * scaleX > dy * scaleY) {
    this.defaultZoom = (2 * this.camera.zoom) / (dx * scaleX);
  } else {
    this.defaultZoom = (2 * this.camera.zoom) / (dy * scaleY);
  }
  let newDefaultZoom = this.defaultZoom;
  let zoomChanges = oldDefaultZoom !== newDefaultZoom;

  function finalize() {
    self.initialConfiguration = false;
    onRotated && onRotated();
    onRotated = false;

    self.baseObject.setRotationFromMatrix(self.currentRotationMatrix);
    self.baseObject.position.x = newPosition.x;
    self.baseObject.position.y = newPosition.y;
    self.baseObject.position.z = newPosition.z;

    self.defaultZoom = newDefaultZoom;
    self.updateViewPort();
    self.updateCameraZoom();
    self.render();
    onDone && onDone();
    onDone = false;
    if (new Date() - self.lastRefresh > 1000 * 60) {
      self.refreshCache();
      self.lastRefresh = new Date();
    }
  }

  let animationID;
  let startTime = new Date();
  let showAnimations = LDR.Options ? LDR.Options.showStepRotationAnimations : 2;
  let animationTimeRotationMS = rotationChanges
    ? (2 - showAnimations) * 300
    : 0; // First rotate,
  let animationTimePositionMS = positionChanges
    ? (2 - showAnimations) * 150
    : 0; // then move and zoom
  if (
    stepDiff != 0 &&
    newLevel !== oldLevel &&
    newLevel - oldLevel === stepDiff
  ) {
    animationTimeRotationMS = 0; // Don't rotate when stepping in.
    animationTimePositionMS = 0;
  }
  let animationTimeMS = animationTimePositionMS + animationTimeRotationMS;
  let lastPosition = oldPosition;

  function animate() {
    animationID = requestAnimationFrame(animate);

    let diffMS = new Date() - startTime;
    if (diffMS >= animationTimeMS) {
      cancelAnimationFrame(animationID);
      finalize();
      return; // Done.
    }

    let progress = diffMS / animationTimeMS;
    self.defaultZoom =
      oldDefaultZoom + (newDefaultZoom - oldDefaultZoom) * progress;
    let pw = oldPLIW + (newPLIW - oldPLIW) * progress;
    let ph = oldPLIH + (newPLIH - oldPLIH) * progress;
    self.updateViewPort([pw, ph]);
    self.updateCameraZoom();

    if (diffMS < animationTimeRotationMS) {
      // Rotate first.
      progress = diffMS / animationTimeRotationMS;

      let oldPos = new THREE.Vector3();
      let oldRot = new THREE.Quaternion();
      let oldScale = new THREE.Vector3();
      oldRotationMatrix.decompose(oldPos, oldRot, oldScale);
      let angleToTurn = oldRot.angleTo(newRot);
      oldRot.rotateTowards(newRot, angleToTurn * progress * 1.1); // *1.1 Ensure it is fully turned.

      let invOldM4 = new THREE.Matrix4();
      invOldM4.copy(oldRotationMatrix).invert();
      let tmpM4 = new THREE.Matrix4();
      tmpM4.compose(oldPos, oldRot, oldScale);

      oldPos.copy(oldPosition);
      oldPos.negate();
      oldPos.applyMatrix4(invOldM4);
      oldPos.applyMatrix4(tmpM4);
      oldPos.negate();
      lastPosition = oldPos;

      self.baseObject.setRotationFromMatrix(tmpM4);
      self.baseObject.position.x = oldPos.x;
      self.baseObject.position.y = oldPos.y;
      self.baseObject.position.z = oldPos.z;
    } else {
      // Move and zoom:
      onRotated && onRotated();
      onRotated = false;
      progress = (diffMS - animationTimeRotationMS) / animationTimePositionMS;

      let tmpPosition = new THREE.Vector3();
      tmpPosition
        .subVectors(newPosition, lastPosition)
        .multiplyScalar(progress)
        .add(lastPosition);

      // Update camera and baseObject:
      self.baseObject.position.x = tmpPosition.x;
      self.baseObject.position.y = tmpPosition.y;
      self.baseObject.position.z = tmpPosition.z;
    }

    self.render();
    self.stats && self.stats.update();
  }

  // Only animate if:
  if (
    !instant &&
    showAnimations < 2 && // show animations
    !stepDiff && // Only animate when not changing steps (disable animations on step changes)
    !this.initialConfiguration && // This is not the initial step &&
    (zoomChanges || rotationChanges || positionChanges)
  ) {
    animate();
  } else {
    finalize();
  }
};

LDR.InstructionsManager.prototype.handleStepsWalked = function (instant) {
  // Helper. Uncomment next lines for step bounding boxes:
  /*if(this.helper) {
        this.baseObject.remove(this.helper);
    }
    if(this.accHelper) {
        this.baseObject.remove(this.accHelper);
    }
    this.accHelper = new THREE.Box3Helper(this.stepHandler.getAccumulatedBounds(), 0x00FF00)
    this.helper = new THREE.Box3Helper(this.stepHandler.getBounds(), 0xFFCC00)
    this.baseObject.add(this.accHelper);
    this.baseObject.add(this.helper);*/
  this.currentStep = this.stepHandler.getCurrentStepIndex();
  window.history.replaceState(
    this.currentStep,
    null,
    this.baseURL + this.currentStep + "&showParts=" + this.showParts,
  );

  this.onWindowResize(true, instant); // Ensure composer and passes are set up correctly.
  this.realignModel(0, undefined, undefined, instant);
  this.onPLIMove(true);
  this.updateUIComponents(false);

  // Update local storage:
  localStorage.setItem(
    "lego_state_" + this.modelID,
    JSON.stringify({
      step: this.currentStep,
      showParts: this.showParts,
    }),
  );
};

LDR.InstructionsManager.prototype.goToStep = function (step, instant) {
  if (this.pliPreviewer.showsSomething()) {
    return; // Don't walk when showing preview.
  }

  console.log("Going to " + step + " from " + this.currentStep);
  let self = this;
  this.stepHandler.moveTo(step);
  this.handleStepsWalked(instant);
};

LDR.InstructionsManager.prototype.nextStep = function () {
  if (this.pliPreviewer.showsSomething()) {
    return; // Don't walk when showing preview.
  }

  // Logic: Parts -> Model -> Next Step Parts
  if (this.showParts) {
    // Currently showing parts, switch to model (same step)
    this.showParts = false;
    this.handleStepsWalked(); // Updates UI and URL
    return;
  }

  // Currently showing model, move to next step parts
  if (this.stepHandler.isAtLastStep()) {
    return;
  }

  let self = this;
  // Set showParts to true for the *next* step
  this.showParts = true;

  this.realignModel(
    1,
    () => self.stepHandler.nextStep(false),
    () => self.handleStepsWalked(),
  );
};

LDR.InstructionsManager.prototype.prevStep = function () {
  if (this.pliPreviewer.showsSomething()) {
    return; // Don't walk when showing preview.
  }

  // Logic: Model -> Parts -> Prev Step Model
  if (!this.showParts) {
    // Currently showing model, switch to parts (same step)
    this.showParts = true;
    this.handleStepsWalked();
    return;
  }

  // Currently showing parts, move to previous step model
  let self = this;
  // Set showParts to false for the *previous* step
  this.showParts = false;

  // Force UI update to ensure canvas is visible for realignModel calculations
  this.updateUIComponents(false);

  this.realignModel(
    -1,
    () => self.stepHandler.prevStep(false),
    () => self.handleStepsWalked(),
  );
};

/*
  Icon: {x, y, width, height, mult, key, partID, c, desc, inlined}
*/
LDR.InstructionsManager.prototype.onPLIClick = function (e) {
  let x = e.layerX || e.clientX;
  let y = e.layerY || e.clientY;
  if (!this.pliBuilder || !this.pliBuilder.clickMap) {
    return;
  }

  // Find clicked icon:
  let hits = this.pliBuilder.clickMap.filter(
    (icon) =>
      x >= icon.x &&
      y >= icon.y &&
      x <= icon.x + icon.DX &&
      y <= icon.y + icon.DY,
  );
  if (hits.length === 0) {
    console.log("No icon was hit at " + x + ", " + y);
    return; // no hits.
  }
  let distSq = (x1, y1) => (x1 - x) * (x1 - x) + (y1 - y) * (y1 - y);
  let icon, bestDist;
  hits.forEach((candidate) => {
    if (!icon) {
      icon = candidate;
    } else {
      let d = distSq(icon.x + candidate.DX * 0.5, icon.y + candidate.DY * 0.5);
      if (d < bestDist) {
        bestDist = d;
        icon = candidate;
      }
    }
  });

  if (this.showEditor) {
    icon.part.original.ghost = !icon.part.original.ghost;
    this.stepHandler.updateMeshCollectors();
    this.updateUIComponents(true);
  } else {
    // Show preview if no editor:
    this.pliPreviewer.showPliPreview(icon);
    let pt = this.pliBuilder.getPartType(icon.partID);
    this.pliPreviewer.setPart(pt, icon.c);
  }
};

LDR.InstructionsManager.prototype.onPLIMove = function (e) {
  if (!(this.showEditor && this.pliBuilder && this.pliBuilder.clickMap)) {
    return; // Not applicable.
  }

  let self = this;

  function update() {
    self.stepHandler && self.stepHandler.updateMeshCollectors();
    self.updatePLI(true);
    self.stepEditor && self.stepEditor.updateCurrentStep();
    self.render();
  }

  function unset() {
    if (self.hovered) {
      self.hovered.hover = false;
      self.hovered = false;
    }
    update();
  }

  if (!e) {
    this.lastPLIMoveX = this.lastPLIMoveY = -1e6;
    unset();
    return;
  }

  let x, y;
  if (e === true) {
    x = this.lastPLIMoveX;
    y = this.lastPLIMoveY;
  } else {
    x = this.lastPLIMoveX = e.layerX || e.clientX;
    y = this.lastPLIMoveY = e.layerY || e.clientY;
  }

  // Find highlighted icon:
  let hits = this.pliBuilder.clickMap.filter(
    (icon) =>
      x >= icon.x &&
      y >= icon.y &&
      x <= icon.x + icon.DX &&
      y <= icon.y + icon.DY,
  );
  if (hits.length === 0) {
    unset();
    return; // no hits.
  }
  let distSq = (x1, y1) => (x1 - x) * (x1 - x) + (y1 - y) * (y1 - y);
  let icon, bestDist;
  hits.forEach((candidate) => {
    if (!icon) {
      icon = candidate;
    } else {
      let d = distSq(icon.x + candidate.DX * 0.5, icon.y + candidate.DY * 0.5);
      if (d < bestDist) {
        bestDist = d;
        icon = candidate;
      }
    }
  });

  if (icon.part.original !== self.hovered || e === true) {
    if (self.hovered) {
      self.hovered.hover = false; // Unhover old part.
    }
    self.hovered = icon.part.original;
    self.hovered.hover = true; // Hover new part.
    update();
  }
};

LDR.InstructionsManager.prototype.hidePliPreview = function () {
  this.pliPreviewer.hidePliPreview();
};

/*
  Assumes LDR.Options in global scope.
 */
LDR.InstructionsManager.prototype.setUpOptions = function () {
  let self = this;
  let optionsDiv = document.getElementById("options");

  LDR.Options.appendHeader(optionsDiv);

  // Toggles:
  LDR.Options.appendContrastOptions(optionsDiv);
  LDR.Options.appendStudHighContrastOptions(optionsDiv);
  LDR.Options.appendStudLogoOptions(optionsDiv);

  // Other options:
  LDR.Options.appendOldBrickColorOptions(optionsDiv);
  LDR.Options.appendAnimationOptions(optionsDiv);

  LDR.Options.appendFooter(optionsDiv);
  LDR.Options.listeners.push(function (partGeometriesChanged) {
    if (partGeometriesChanged) {
      location.reload(); // Geometries have been deleted due to optimizations, so reload the page.
    } else {
      self.stepHandler.updateMeshCollectors();
      self.updateUIComponents(true);
    }
    self.ldrButtons.hideElementsAccordingToOptions();
    self.onWindowResize(true);
  });
};
