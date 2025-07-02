// Configuration object for all particle behavior constants
const PARTICLE_CONFIG = {
 // Particle appearance
 CIRCLE_RADIUS: 3,
 MAX_OPACITY: 0.05,
 ORANGE_COLOR: '#ff6b35', // Brighter orange

 // Grid layout
 GRID_SPACING: 40,

 // Mouse interaction
 PATH_FORCE_RADIUS: 200, // Radius for path-based forces
 BASE_PUSH_FORCE: 0.3,
 MOVEMENT_FORCE_MULTIPLIER: 4.0,
 MAX_MOUSE_VELOCITY: 5000,

 // Physics
 DAMPING: 0.975,
 SPRING_STRENGTH: 0.05,

 // Animation
 TARGET_FPS: 60,
 MAX_FRAME_TIME: 0.1, // seconds

 // Pulse effect
 PULSE_SPEED: 150, // pixels per second - faster wave
 PULSE_PEAK_OPACITY: 0.15, // less opaque
 PULSE_LOOP_INTERVAL: 8000, // milliseconds between pulses - less frequent
 PULSE_DURATION: 1500, // how long each pulse lasts at a particle
 
 // Intro pulse effect
 INTRO_PULSE_SPEED: 1200, // pixels per second - extremely fast
 
 // Click pulse effect
 CLICK_PULSE_SPEED: 1600, // pixels per second - 2x faster
 CLICK_PULSE_PEAK_OPACITY: 0.2, // slightly more visible than regular pulses
 CLICK_PULSE_DURATION: 800, // shorter duration for snappy effect

 // Debug
 DEBUG_MOUSE_TRACKING: false,
 DEBUG_DOT_RADIUS: 2,
 DEBUG_MAX_DOTS: 100,
};

// Global particle state
const GLOBAL_STATE = {
 // Particles array
 particles: [],

 // Animation reference
 animationFrameId: null,

 // Current animation state
 active: false,

 // Time tracking
 lastFrameTime: 0,

 // Mouse tracking
 mouseX: 0,
 mouseY: 0,
 lastMouseX: 0,
 lastMouseY: 0,
 mouseVX: 0,
 mouseVY: 0,
 lastMouseTime: 0,

 // Pulse effect tracking
 activePulses: [], // Array of { startTime, centerX, centerY }
 
 // System timing
 systemStartTime: 0,

 // Debug tracking
 debugMousePositions: [],
};

// Canvas and context references
let canvas = null;
let ctx = null;

// Global DOM elements
let wrapper = null;
let resizeListener = null;
let mouseMoveListener = null;
let mouseDownListener = null;

// Helper function to calculate distance from point to line segment
function pointToLineSegmentDistance(px, py, x1, y1, x2, y2) {
  // Vector from line start to point
  const dx = px - x1;
  const dy = py - y1;
  
  // Line segment vector
  const lineVecX = x2 - x1;
  const lineVecY = y2 - y1;
  const lineLengthSq = lineVecX * lineVecX + lineVecY * lineVecY;
  
  // If line segment has zero length, return distance to start point
  if (lineLengthSq === 0) {
    return {
      distance: Math.sqrt(dx * dx + dy * dy),
      closestPoint: { x: x1, y: y1 }
    };
  }
  
  // Parameter t represents position along line segment (0 = start, 1 = end)
  const t = Math.max(0, Math.min(1, (dx * lineVecX + dy * lineVecY) / lineLengthSq));
  
  // Closest point on line segment
  const closestX = x1 + t * lineVecX;
  const closestY = y1 + t * lineVecY;
  
  // Distance from point to closest point on line segment
  const distX = px - closestX;
  const distY = py - closestY;
  const distance = Math.sqrt(distX * distX + distY * distY);
  
  return {
    distance: distance,
    closestPoint: { x: closestX, y: closestY }
  };
}

// Simple Particle class for grid-based circles
class Particle {
 constructor(x, y) {
   // Fixed position
   this.x = x;
   this.y = y;
   
   // Visual properties
   this.baseOpacity = 0; // Start at 0, will be set by intro pulse
   this.hasBeenRevealed = false; // Track if intro pulse has reached this particle
   
   // Pulse effect properties
   this.distanceFromCenter = 0;
   this.pulseOpacity = 0;
   
 }

 draw(ctx) {
   // Calculate total opacity: base + pulse
   let totalOpacity = this.baseOpacity + this.pulseOpacity;
   
   // Add subtle mouse proximity highlighting
   const mouseDistance = Math.sqrt((this.x - GLOBAL_STATE.mouseX) ** 2 + (this.y - GLOBAL_STATE.mouseY) ** 2);
   if (mouseDistance < PARTICLE_CONFIG.PATH_FORCE_RADIUS) {
     const proximityFactor = 1 - (mouseDistance / PARTICLE_CONFIG.PATH_FORCE_RADIUS);
     totalOpacity += proximityFactor * 0.07; // Slightly less intense highlight
   }
   
   if (totalOpacity <= 0) return;
   
   ctx.save();
   ctx.globalAlpha = Math.min(1, totalOpacity);
   ctx.fillStyle = 'white';
   ctx.beginPath();
   ctx.arc(this.x, this.y, PARTICLE_CONFIG.CIRCLE_RADIUS, 0, Math.PI * 2);
   ctx.fill();
   ctx.restore();
 }

 update() {
   // Update pulse effects
   this.updatePulse();
 }
 
 
 updatePulse() {
   const currentTime = performance.now();
   this.pulseOpacity = 0;
   
   // Check all active pulses
   GLOBAL_STATE.activePulses.forEach(pulse => {
     const timeSincePulseStart = currentTime - pulse.startTime;
     
     // Use different speed for different pulse types
     let pulseSpeed, pulseDuration, peakOpacity;
     if (pulse.isIntro) {
       pulseSpeed = PARTICLE_CONFIG.INTRO_PULSE_SPEED;
       pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
       peakOpacity = PARTICLE_CONFIG.PULSE_PEAK_OPACITY;
     } else if (pulse.isClick) {
       pulseSpeed = PARTICLE_CONFIG.CLICK_PULSE_SPEED;
       pulseDuration = PARTICLE_CONFIG.CLICK_PULSE_DURATION;
       peakOpacity = PARTICLE_CONFIG.CLICK_PULSE_PEAK_OPACITY;
     } else {
       pulseSpeed = PARTICLE_CONFIG.PULSE_SPEED;
       pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
       peakOpacity = PARTICLE_CONFIG.PULSE_PEAK_OPACITY;
     }
     
     // Calculate when this pulse wave should reach this particle
     const waveRadius = (timeSincePulseStart / 1000) * pulseSpeed;
     
     // Calculate distance from this pulse's center (not always canvas center)
     const particleDistance = Math.sqrt((this.x - pulse.centerX) ** 2 + (this.y - pulse.centerY) ** 2);
     
     // Check if the wave has reached this particle
     if (waveRadius >= particleDistance) {
       // For intro pulse, permanently set base opacity when wave reaches particle
       if (pulse.isIntro && !this.hasBeenRevealed) {
         this.baseOpacity = PARTICLE_CONFIG.MAX_OPACITY;
         this.hasBeenRevealed = true;
       }
       
       // Calculate how long the wave has been at this particle
       const timeAtParticle = timeSincePulseStart - (particleDistance / pulseSpeed * 1000);
       
       if (timeAtParticle >= 0 && timeAtParticle < pulseDuration) {
         const pulsePhase = timeAtParticle / pulseDuration;
         
         let pulseContribution = 0;
         
         if (pulse.isIntro) {
           // Intro pulse: starts at 0, peaks, then settles at base opacity
           if (pulsePhase < 0.3) {
             // Rising phase: 0 to peak
             const riseProgress = pulsePhase / 0.3;
             pulseContribution = riseProgress * peakOpacity;
           } else {
             // Falling phase: peak to 0 (base opacity already set above)
             const fallProgress = (pulsePhase - 0.3) / 0.7;
             pulseContribution = peakOpacity * (1 - fallProgress);
           }
         } else {
           // Regular and click pulses: normal pulse behavior
           if (pulsePhase < 0.3) {
             // Rising phase: 0 to peak
             pulseContribution = (pulsePhase / 0.3) * peakOpacity;
           } else if (pulsePhase < 1) {
             // Falling phase: peak to 0
             const fallProgress = (pulsePhase - 0.3) / 0.7;
             pulseContribution = peakOpacity * (1 - fallProgress);
           }
         }
         
         // Add this pulse's contribution (multiple pulses can stack)
         this.pulseOpacity += pulseContribution;
       }
     }
   });
   
   // Clamp to maximum opacity
   this.pulseOpacity = Math.min(this.pulseOpacity, PARTICLE_CONFIG.PULSE_PEAK_OPACITY * 2);
 }
}

// Create the particle system and initialize everything needed
function createParticleSystem() {
 console.log("[Particles] Creating particle system");

 if (GLOBAL_STATE.active) {
   console.log("[Particles] System already active, skipping creation");
   return; // Already active
 }

 // Get landing-root element for positioning
 const landingRoot = document.querySelector('.landing-root');
 const landingHero = document.querySelector('.landing-hero');
 
 // Calculate positioning based on landing-root
 let leftPadding = 56; // Default desktop padding
 let rightPadding = 56;
 let containerHeight = window.innerHeight; // Default to viewport height
 
 if (landingRoot) {
   const rootStyles = window.getComputedStyle(landingRoot);
   leftPadding = parseInt(rootStyles.paddingLeft) || 56;
   rightPadding = parseInt(rootStyles.paddingRight) || 56;
 }
 
 if (landingHero) {
   containerHeight = landingHero.offsetHeight;
 }

 // Create wrapper element
 wrapper = document.createElement('div');
 wrapper.setAttribute('data-particle-wrapper', 'true');
 Object.assign(wrapper.style, {
   position: 'absolute',
   top: '0',
   left: `${leftPadding}px`,
   width: `calc(100% - ${leftPadding + rightPadding}px)`,
   height: `${containerHeight}px`,
   overflow: 'hidden',
   pointerEvents: 'none',
   zIndex: '-1'
 });

 // Create canvas
 canvas = document.createElement('canvas');
 canvas.setAttribute('data-particles', 'true');
 Object.assign(canvas.style, {
   position: 'absolute',
   top: '0',
   left: '0',
   width: '100%',
   height: '100%',
   pointerEvents: 'none',
   zIndex: '-1'
 });

 // Set canvas size to match wrapper dimensions
 canvas.width = window.innerWidth - leftPadding - rightPadding;
 canvas.height = containerHeight;

 // Get context
 ctx = canvas.getContext('2d');

 // Add canvas to wrapper
 wrapper.appendChild(canvas);

 // Add wrapper to body
 if (document.body.firstChild) {
   document.body.insertBefore(wrapper, document.body.firstChild);
 } else {
   document.body.appendChild(wrapper);
 }

 // Create grid-based particles
 createGridParticles();

 // Initialize animations
 GLOBAL_STATE.systemStartTime = performance.now();
 GLOBAL_STATE.activePulses = [];
 
 // Add immediate intro pulse that moves very fast
 GLOBAL_STATE.activePulses.push({
   startTime: performance.now(),
   centerX: canvas.width / 2,
   centerY: canvas.height / 2,
   isIntro: true // Mark as intro pulse for different speed
 });

 // Set up simple mouse tracking
 mouseMoveListener = (e) => {
   // Calculate mouse position relative to the canvas
   if (wrapper) {
     const wrapperRect = wrapper.getBoundingClientRect();
     GLOBAL_STATE.mouseX = e.clientX - wrapperRect.left;
     GLOBAL_STATE.mouseY = e.clientY - wrapperRect.top;
   } else {
     // Fallback to page coordinates
     GLOBAL_STATE.mouseX = e.pageX;
     GLOBAL_STATE.mouseY = e.pageY;
   }
 };

 document.addEventListener('mousemove', mouseMoveListener, { passive: true });
 
 // Set up mousedown listener for spawning pulses
 mouseDownListener = (e) => {
   // Calculate mousedown position relative to the canvas
   let clickX, clickY;
   if (wrapper) {
     const wrapperRect = wrapper.getBoundingClientRect();
     clickX = e.clientX - wrapperRect.left;
     clickY = e.clientY - wrapperRect.top;
   } else {
     // Fallback to page coordinates
     clickX = e.pageX;
     clickY = e.pageY;
   }
   
   // Create a new click pulse at the mousedown position
   GLOBAL_STATE.activePulses.push({
     startTime: performance.now(),
     centerX: clickX,
     centerY: clickY,
     isClick: true // Mark as click pulse for different behavior
   });
 };
 
 document.addEventListener('mousedown', mouseDownListener);

 // Handle resize
  resizeListener = () => {
    // Check if particles should still be shown after resize
    if (!shouldShowParticles()) {
      destroyParticleSystem();
      return;
    }

    if (canvas && wrapper) {
      // Recalculate dimensions
      const landingRoot = document.querySelector('.landing-root');
      const landingHero = document.querySelector('.landing-hero');
      const rootRect = landingRoot.getBoundingClientRect();
      const heroRect = landingHero.getBoundingClientRect();
      const canvasWidth = rootRect.width;
      const canvasHeight = heroRect.height;

      // Update wrapper positioning
      Object.assign(wrapper.style, {
        left: `${rootRect.left}px`,
        width: `${canvasWidth}px`,
        top: `0`,
        height: `${canvasHeight}px`,
      });

      // Update canvas size
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // Recreate grid particles for new dimensions
      createGridParticles();
    }
  };

 window.addEventListener('resize', resizeListener);
  // Wait for layout to finish and re-render
  setTimeout(resizeListener, 0);

 // Initialize timing
 GLOBAL_STATE.lastFrameTime = performance.now();
 GLOBAL_STATE.lastMouseTime = performance.now();
 
 // Initialize mouse position to center of canvas
 GLOBAL_STATE.mouseX = canvas.width / 2;
 GLOBAL_STATE.mouseY = canvas.height / 2;
 GLOBAL_STATE.lastMouseX = GLOBAL_STATE.mouseX;
 GLOBAL_STATE.lastMouseY = GLOBAL_STATE.mouseY;

 // Start animation
 startAnimation();

 // Mark as active
 GLOBAL_STATE.active = true;
}

// Create particles in a grid layout
function createGridParticles() {
  if (!canvas) return;
  
  GLOBAL_STATE.particles = [];
  const baseSpacing = PARTICLE_CONFIG.GRID_SPACING;
  const edgeMargin = 40; // Constant distance from edges
  
  // Get exclusion zones from landing-hero direct children
  const exclusionZones = getExclusionZones();
  
  // Calculate available space after accounting for edge margins
  const availableWidth = canvas.width - (2 * edgeMargin);
  const availableHeight = canvas.height - (2 * edgeMargin);
  
  // Calculate maximum number of particles that fit with base spacing
  const maxCols = Math.floor(availableWidth / baseSpacing);
  const maxRows = Math.floor(availableHeight / baseSpacing);
  
  // Adjust spacing to distribute particles evenly with exact edge margins
  const actualSpacingX = maxCols > 0 ? availableWidth / maxCols : baseSpacing;
  const actualSpacingY = maxRows > 0 ? availableHeight / maxRows : baseSpacing;
  
  // Calculate center for opacity calculations
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  for (let row = 0; row <= maxRows; row++) {
    for (let col = 0; col <= maxCols; col++) {
      const x = edgeMargin + col * actualSpacingX;
      const y = edgeMargin + row * actualSpacingY;
      
      // Skip if particle overlaps with any exclusion zone
      if (isPointInExclusionZones(x, y, exclusionZones)) continue;
      
      const particle = new Particle(x, y);
      
      // Calculate distance from center for pulse effect
      particle.distanceFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      
      // Start with zero opacity - intro pulse will reveal them
      particle.baseOpacity = 0;
      
      GLOBAL_STATE.particles.push(particle);
    }
  }
}

// Get bounding rectangles of specific landing page elements
function getExclusionZones() {
  if (!wrapper) return [];
  
  const wrapperRect = wrapper.getBoundingClientRect();
  const exclusionZones = [];
  const margin = 25; // 25px margin around bounding boxes
  
  // Specific selectors to avoid overlap with
  const selectors = [
    '.landing-title',
    '.landing-subtitle', 
    '.libraries-grid',
    '.landing-buttons',
    '.platform-icons-label',
    '.platform-icons-row'
  ];
  
  selectors.forEach(selector => {
    const element = document.querySelector(selector);
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    
    // Convert to canvas coordinates (relative to wrapper) and add margin
    const canvasRect = {
      left: rect.left - wrapperRect.left - margin,
      top: rect.top - wrapperRect.top - margin,
      right: rect.right - wrapperRect.left + margin,
      bottom: rect.bottom - wrapperRect.top + margin
    };
    
    // Only add if the rect intersects with canvas bounds
    if (canvasRect.right > 0 && canvasRect.left < canvas.width &&
        canvasRect.bottom > 0 && canvasRect.top < canvas.height) {
      exclusionZones.push(canvasRect);
    }
  });
  
  return exclusionZones;
}

// Check if a point (with circle radius) overlaps with any exclusion zone
function isPointInExclusionZones(x, y, exclusionZones) {
  const radius = PARTICLE_CONFIG.CIRCLE_RADIUS;
  
  for (const zone of exclusionZones) {
    // Check if circle centered at (x, y) with given radius overlaps with rectangle
    const closestX = Math.max(zone.left, Math.min(x, zone.right));
    const closestY = Math.max(zone.top, Math.min(y, zone.bottom));
    
    const distanceX = x - closestX;
    const distanceY = y - closestY;
    const distanceSq = distanceX * distanceX + distanceY * distanceY;
    
    if (distanceSq <= radius * radius) {
      return true;
    }
  }
  
  return false;
}

// Manage pulse creation and cleanup
function managePulses() {
  const currentTime = performance.now();
  const timeSinceSystemStart = currentTime - GLOBAL_STATE.systemStartTime;
  
  // Calculate how many regular pulses we should have (excluding the intro pulse)
  // Start regular pulses after a delay to let the intro pulse finish
  const regularPulseStartDelay = 2000; // 2 seconds after system start
  if (timeSinceSystemStart < regularPulseStartDelay) {
    return;
  }
  
  const adjustedTime = timeSinceSystemStart - regularPulseStartDelay;
  const shouldHaveRegularPulseCount = Math.floor(adjustedTime / PARTICLE_CONFIG.PULSE_LOOP_INTERVAL) + 1;
  const currentRegularPulseCount = GLOBAL_STATE.activePulses.filter(p => !p.isIntro).length;
  
  // Create new regular pulses if needed
  while (currentRegularPulseCount < shouldHaveRegularPulseCount) {
    const regularPulseIndex = currentRegularPulseCount;
    const pulseStartTime = GLOBAL_STATE.systemStartTime + regularPulseStartDelay + (regularPulseIndex * PARTICLE_CONFIG.PULSE_LOOP_INTERVAL);
    
    GLOBAL_STATE.activePulses.push({
      startTime: pulseStartTime,
      centerX: canvas ? canvas.width / 2 : 0,
      centerY: canvas ? canvas.height / 2 : 0,
      isIntro: false
    });
    break; // Only add one pulse per frame
  }
  
  // Clean up pulses that are too old (beyond their effective range)
  const maxCanvasDiagonal = canvas ? Math.sqrt(canvas.width ** 2 + canvas.height ** 2) : 1000;
  
  GLOBAL_STATE.activePulses = GLOBAL_STATE.activePulses.filter(pulse => {
    let pulseSpeed, pulseDuration;
    if (pulse.isIntro) {
      pulseSpeed = PARTICLE_CONFIG.INTRO_PULSE_SPEED;
      pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
    } else if (pulse.isClick) {
      pulseSpeed = PARTICLE_CONFIG.CLICK_PULSE_SPEED;
      pulseDuration = PARTICLE_CONFIG.CLICK_PULSE_DURATION;
    } else {
      pulseSpeed = PARTICLE_CONFIG.PULSE_SPEED;
      pulseDuration = PARTICLE_CONFIG.PULSE_DURATION;
    }
    
    const maxPulseLifetime = (maxCanvasDiagonal / pulseSpeed * 1000) + pulseDuration;
    return (currentTime - pulse.startTime) < maxPulseLifetime;
  });
}

// Start the animation loop
function startAnimation() {
 if (GLOBAL_STATE.animationFrameId !== null) {
   // Animation already running
   return;
 }

 console.log("[Particles] Starting animation");

 const TARGET_FPS = PARTICLE_CONFIG.TARGET_FPS;
 const FRAME_TIME = 1000 / TARGET_FPS;

 function animate() {
   const currentTime = performance.now();
   const timeSinceLastFrame = currentTime - GLOBAL_STATE.lastFrameTime;

   // Only render if enough time has passed for next frame
   if (timeSinceLastFrame >= FRAME_TIME) {
     const deltaTime = Math.min(timeSinceLastFrame / 1000, PARTICLE_CONFIG.MAX_FRAME_TIME);
     GLOBAL_STATE.lastFrameTime = currentTime;

     // Manage pulse creation and cleanup
     managePulses();
     
     // Update particles (just activation, no physics)
     GLOBAL_STATE.particles.forEach(particle => {
       particle.update();
     });

     // Make sure canvas and context exist before drawing
     if (canvas && ctx) {
       // Clear canvas
       ctx.clearRect(0, 0, canvas.width, canvas.height);

       // Draw particles
       GLOBAL_STATE.particles.forEach(particle => {
         particle.draw(ctx);
       });

       // Draw debug mouse positions
       if (PARTICLE_CONFIG.DEBUG_MOUSE_TRACKING && GLOBAL_STATE.debugMousePositions.length > 0) {
         ctx.save();
         ctx.fillStyle = 'red';
         ctx.globalAlpha = 1;
         
         GLOBAL_STATE.debugMousePositions.forEach((pos, index) => {
           // Fade older positions
           const age = GLOBAL_STATE.debugMousePositions.length - index;
           const alpha = Math.max(0.3, 1 - (age / PARTICLE_CONFIG.DEBUG_MAX_DOTS));
           ctx.globalAlpha = alpha;
           
           ctx.beginPath();
           ctx.arc(pos.x, pos.y, PARTICLE_CONFIG.DEBUG_DOT_RADIUS, 0, Math.PI * 2);
           ctx.fill();
         });
         
         ctx.restore();
       }
     }
   }

   // Continue animation
   GLOBAL_STATE.animationFrameId = requestAnimationFrame(animate);
 }

 GLOBAL_STATE.animationFrameId = requestAnimationFrame(animate);
}

// Completely destroy the particle system
function destroyParticleSystem() {
 console.log("[Particles] Destroying particle system");

 // Cancel animation frame
 if (GLOBAL_STATE.animationFrameId !== null) {
   cancelAnimationFrame(GLOBAL_STATE.animationFrameId);
   GLOBAL_STATE.animationFrameId = null;
 }

 // Remove event listeners
 if (mouseMoveListener) {
   document.removeEventListener('mousemove', mouseMoveListener);
   mouseMoveListener = null;
 }
 
 if (mouseDownListener) {
   document.removeEventListener('mousedown', mouseDownListener);
   mouseDownListener = null;
 }

 if (resizeListener) {
   window.removeEventListener('resize', resizeListener);
   resizeListener = null;
 }

 // Remove DOM elements
 if (wrapper && document.body.contains(wrapper)) {
   wrapper.remove();
 }

 // Clear references
 canvas = null;
 ctx = null;
 wrapper = null;

 // Mark as inactive
 GLOBAL_STATE.active = false;
}

// Check if the page should show particles (.landing-root exists and screen width >= 730px)
function shouldShowParticles() {
 return document.querySelector('.landing-root') !== null && window.innerWidth >= 730;
}

// Handle mutation observer updates
function observerInitialize() {
 // Check if we should show or hide particles
 if (shouldShowParticles()) {
   if (!GLOBAL_STATE.active) {
     console.log("[Particles] Landing page detected - creating particles");
     createParticleSystem();
   }
 } else {
   if (GLOBAL_STATE.active) {
     console.log("[Particles] Not a landing page - destroying particles");
     destroyParticleSystem();
   }
 }

 // Mark all containers as initialized
 document.querySelectorAll('.particle-container:not([data-particle-initialized])').forEach(container => {
   container.setAttribute('data-particle-initialized', 'true');
 });
}

// Compatibility function for observer-manager.js
function initializeAllParticles() {
 observerInitialize();
}

// Initialize after a small delay
//setTimeout(observerInitialize, 50);
