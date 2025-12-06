"use strict";

LDR.Buttons = function (actions, element, options) {
  // Bind Actions to Existing Elements

  // 1. Close Button
  const closeBtn = document.getElementById("close_button");
  if (closeBtn && actions.closeInstructions) {
    closeBtn.addEventListener("click", actions.closeInstructions);
  }

  // 2. Reset Camera Button
  this.resetCameraButton = document.getElementById("reset_camera_button");
  // Long press logic for Fullscreen
  if (this.resetCameraButton) {
    let pressTimer;
    let longPressed = false;
    let semaphore = false; // Prevent double firing

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
  }

  // ============================================================
  // 3. Navigation Buttons (IMPROVED FOR MOBILE)
  // ============================================================
  const prevBtn = document.getElementById("prev_button");
  const nextBtn = document.getElementById("next_button");

  this.backButton = prevBtn;
  this.nextButton = nextBtn;

  /**
   * Helper to handle taps that allows for slight finger wiggling
   * and prevents ghost clicks.
   */
  const bindResponsiveButton = (btn, action) => {
    if (!btn || !action) return;

    let startX, startY;
    let isTouchAction = false;

    // 1. Touch Start: Record position
    btn.addEventListener("touchstart", (e) => {
        isTouchAction = true;
        const t = e.changedTouches[0];
        startX = t.clientX;
        startY = t.clientY;
        // Optional: Add visual feedback class here if CSS :active isn't enough
    }, { passive: true });

    // 2. Touch End: Check if finger stayed within "Tap" tolerance
    btn.addEventListener("touchend", (e) => {
        const t = e.changedTouches[0];
        const diffX = Math.abs(t.clientX - startX);
        const diffY = Math.abs(t.clientY - startY);

        // Allow 30px of wiggle room (generous for mobile thumbs)
        if (diffX < 30 && diffY < 30) {
            e.preventDefault(); // Prevent generation of Mouse events
            action();
        }

        // Reset flag after a short delay to allow Mouse events to work again if needed
        setTimeout(() => { isTouchAction = false; }, 500);
    });

    // 3. Click: Fallback for Desktop Mouse users
    btn.addEventListener("click", (e) => {
        // If this triggered via touch already, ignore the ghost click
        if (isTouchAction) {
            e.stopImmediatePropagation();
            return;
        }
        action();
    });
  };

  bindResponsiveButton(prevBtn, actions.prevStep);
  bindResponsiveButton(nextBtn, actions.nextStep);

  // 4. Progress Bars (Top and Bottom)
  this.progressBars = [
    document.getElementById("progress_bar_top"),
    document.getElementById("progress_bar_bottom"),
  ].filter((el) => el != null);

  // Common Handler for Progress Bar Interaction
  const handleProgress = (e, barElement) => {
    if (!actions.clickProgressBar) return;
    let rect = barElement.getBoundingClientRect();
    let clientX = e.clientX;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
    }
    let x = clientX - rect.left;
    let percent = Math.max(0, Math.min(1, x / rect.width));
    actions.clickProgressBar(percent);
  };

  this.progressBars.forEach((bar) => {
    let isDragging = false;

    const onPointerDown = (e) => {
      isDragging = true;
      handleProgress(e, bar);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (isDragging) {
        handleProgress(e, bar);
      }
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    bar.addEventListener("mousedown", onPointerDown);
    bar.addEventListener("touchstart", onPointerDown, { passive: false });

    // Attach global move/up to window to handle dragging outside the bar
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchend", onPointerUp);
  });

  // --- COMPATIBILITY LAYER ---
  // The InstructionsManager expects to find 'progressDot' and 'progressLine' properties
  // on this object and set their style. We proxy these to update ALL bars.

  const self = this;

  // Mock object for progressDot that updates all dots
  this.progressDot = {
      style: new Proxy({}, {
          set: function(target, prop, value) {
              self.progressBars.forEach(bar => {
                  const dot = bar.querySelector(".progress_dot");
                  if(dot) dot.style[prop] = value;
              });
              return true;
          }
      })
  };

  // Mock object for progressLine that updates all lines
  this.progressLine = {
      style: new Proxy({}, {
          set: function(target, prop, value) {
              self.progressBars.forEach(bar => {
                  const line = bar.querySelector(".progress_line");
                  if(line) line.style[prop] = value;
              });
              return true;
          }
      })
  };
};

LDR.Buttons.prototype.hideElementsAccordingToOptions = function () {};

// Functions for hiding next/prev buttons:
LDR.Buttons.prototype.setVisibility = function (showPrev, showNext) {
  if (this.backButton) {
      this.backButton.classList.toggle("hidden", !showPrev);
  }
  if (this.nextButton) {
      this.nextButton.classList.toggle("hidden", !showNext);
  }
};

// This needs to update BOTH progress bars (top and bottom)
LDR.Buttons.prototype.updateProgressBar = function (pct) {
  this.progressBars.forEach((bar) => {
    const dot = bar.querySelector(".progress_dot");
    const line = bar.querySelector(".progress_line");

    if (dot) dot.style.left = pct + "%";
    if (line) {
      line.style.background = `linear-gradient(to right, #fdc700 ${pct}%, white ${pct}%)`;
    }
  });
};

// Replaces the old direct style manipulation in InstructionsManager
// Make sure to call this method from InstructionsManager instead of setting styles directly there.
