"use strict";

LDR.Buttons = function (actions, element, options) {
  // 1. Close Button (Top Right)
  if (actions.closeInstructions) {
    this.closeButton = this.createDiv(
      "close_button",
      actions.closeInstructions,
    );
    this.closeButton.setAttribute("class", "ui_control");
    const closeImg = document.createElement("img");
    closeImg.src = "img/x.svg";
    closeImg.style.pointerEvents = "none";
    this.closeButton.appendChild(closeImg);
    this.closeButton.addEventListener("contextmenu", (e) => e.preventDefault());
    element.appendChild(this.closeButton);
  }

  // 2. Reset Camera Button (Top Right)
  // Pass null for onclick to handle manually for long-press support
  this.resetCameraButton = this.createDiv("reset_camera_button", null);
  const resetCameraImg = document.createElement("img");
  resetCameraImg.src = "img/refresh-cw.svg";
  // Prevent long-press on image triggering download popup
  resetCameraImg.style.pointerEvents = "none";
  this.resetCameraButton.appendChild(resetCameraImg);
  element.appendChild(this.resetCameraButton);

  // Prevent context menu on the button itself
  this.resetCameraButton.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // Long press logic for Fullscreen on Reset Camera Button
  let pressTimer;
  let longPressed = false;
  let semaphore = false; // Prevent double firing on touch devices

  const startPress = () => {
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (!document.fullscreenElement) {
        document.documentElement
          .requestFullscreen()
          .catch((e) => console.warn(e));
      } else {
        document.exitFullscreen();
      }
    }, 800); // ms
  };

  const cancelPress = () => clearTimeout(pressTimer);

  this.resetCameraButton.addEventListener("mousedown", startPress);
  this.resetCameraButton.addEventListener("touchstart", startPress, {
    passive: true,
  });
  this.resetCameraButton.addEventListener("mouseleave", cancelPress);
  this.resetCameraButton.addEventListener("touchmove", cancelPress);

  this.resetCameraButton.addEventListener("mouseup", () => {
    cancelPress();
    if (!semaphore && !longPressed && actions.resetCameraPosition)
      actions.resetCameraPosition();
    semaphore = false;
  });

  this.resetCameraButton.addEventListener("touchend", () => {
    cancelPress();
    semaphore = true;
    if (!longPressed && actions.resetCameraPosition)
      actions.resetCameraPosition();
  });

  // 3. Progress Bar (Center)
  this.progressBar = this.createDiv("progress_bar_container");
  this.progressBar.addEventListener("contextmenu", (e) => e.preventDefault());

  // Progress Bar Background
  this.progressBg = this.createDiv("progress_bar_background");
  this.progressBar.appendChild(this.progressBg);

  // Progress Line
  this.progressLine = this.createDiv("progress_line");
  this.progressBar.appendChild(this.progressLine);

  // Progress Dot
  this.progressDot = this.createDiv("progress_dot");
  const progressDotImg = document.createElement("img");
  progressDotImg.src = "img/brand-lego.svg";
  progressDotImg.style.pointerEvents = "none";
  this.progressDot.appendChild(progressDotImg);
  this.progressBar.appendChild(this.progressDot);

  // Add click listener to jump to step
  let self = this;
  let isDragging = false;

  const handleProgress = (e) => {
    if (!actions.clickProgressBar) return;
    let rect = self.progressBar.getBoundingClientRect();
    let clientX = e.clientX;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
    }
    let x = clientX - rect.left;
    let percent = Math.max(0, Math.min(1, x / rect.width));
    actions.clickProgressBar(percent);
  };

  const onPointerDown = (e) => {
    isDragging = true;
    handleProgress(e);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (isDragging) {
      handleProgress(e);
    }
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  this.progressBar.addEventListener("mousedown", onPointerDown);
  this.progressBar.addEventListener("touchstart", onPointerDown, {
    passive: false,
  });

  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("touchmove", onPointerMove, { passive: false });

  window.addEventListener("mouseup", onPointerUp);
  window.addEventListener("touchend", onPointerUp);

  this.progressBarWrapper = this.createDiv("progress-bar-wrapper");
  this.progressBarWrapper.appendChild(this.progressBar);

  // Append the center container to the main element
  element.appendChild(this.progressBarWrapper);

  // 6. Back Button (Bottom Left)
  if (actions.prevStep) {
    this.backButton = this.createDiv("prev_button", actions.prevStep);
    this.backButton.setAttribute("class", "ui_control");
    const image = document.createElement("img");
    image.setAttribute("src", "img/chevron-left.svg");
    image.style.pointerEvents = "none";
    this.backButton.appendChild(image);
    this.backButton.addEventListener("contextmenu", (e) => e.preventDefault());
    element.appendChild(this.backButton);
  }

  // 7. Next Button (Bottom Right)
  if (actions.nextStep) {
    this.nextButton = this.createDiv("next_button", actions.nextStep);
    this.nextButton.setAttribute("class", "ui_control");
    const image = document.createElement("img");
    image.setAttribute("src", "img/chevron-right.svg");
    image.style.pointerEvents = "none";
    this.nextButton.appendChild(image);
    this.nextButton.addEventListener("contextmenu", (e) => e.preventDefault());
    element.appendChild(this.nextButton);
  }
};

LDR.Buttons.prototype.hideElementsAccordingToOptions = function () {};

// Primitive helper methods for creating elements for buttons:
LDR.Buttons.prototype.createDiv = function (id, onclick, classA) {
  return this.create("div", id, onclick, classA);
};
LDR.Buttons.prototype.create = function (type, id, onclick, classA) {
  let ret = document.createElement(type);
  ret.setAttribute("id", id);
  if (onclick) {
    let semaphore = false;
    ret.addEventListener("mouseup", (e) => {
      if (!semaphore) {
        onclick(e);
      }
      semaphore = false;
    });
    ret.addEventListener("touchend", (e) => {
      semaphore = true;
      onclick(e);
    });
  }
  if (classA) {
    ret.setAttribute("class", classA);
  }
  return ret;
};

// Functions for hiding next/prev buttons:
LDR.Buttons.prototype.setVisibility = function (showPrev, showNext) {
  if (this.backButton)
    this.backButton.style.visibility = showPrev ? "visible" : "hidden";
  if (this.nextButton)
    this.nextButton.style.visibility = showNext ? "visible" : "hidden";
};
LDR.Buttons.prototype.setShownStep = function (step) {
  if (this.stepInput) this.stepInput.value = "" + step;
};
