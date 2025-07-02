// Configuration object for all particle behavior constants
const PARTICLE_CONFIG = {
 // Particle appearance
 CIRCLE_RADIUS: 3,
 BASE_OPACITY: 0.04,
 MAX_OPACITY: 0.12,
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
   // Grid position (original/rest position)
   this.originX = x;
   this.originY = y;
   
   // Current position
   this.x = x;
   this.y = y;
   
   // Velocity
   this.vx = 0;
   this.vy = 0;
   
   // Visual properties
   this.baseOpacity = 0;
   this.activation = 0; // 0 = white, 1 = orange
   
   // Physics properties
   this.damping = PARTICLE_CONFIG.DAMPING;
   this.springStrength = PARTICLE_CONFIG.SPRING_STRENGTH;
 }

 draw(ctx) {
   if (this.baseOpacity <= 0) return;
   
   ctx.save();
   
   // Calculate velocity magnitude for activation intensity
   const velocityMagnitude = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
   const velocityActivation = Math.min(1, velocityMagnitude / 3); // Lower threshold for activation
   const totalActivation = Math.max(this.activation, velocityActivation);
   
   // Draw white base particle
   if (totalActivation < 1) {
     ctx.globalAlpha = this.baseOpacity * (1 - totalActivation);
     ctx.fillStyle = 'white';
     ctx.beginPath();
     ctx.arc(this.x, this.y, PARTICLE_CONFIG.CIRCLE_RADIUS, 0, Math.PI * 2);
     ctx.fill();
   }
   
   // Draw orange activated particle with moderate intensity
   if (totalActivation > 0) {
     // Moderate orange activation - visible but not overwhelming
     ctx.globalAlpha = Math.min(1, totalActivation * 0.35); // Moderate opacity control
     ctx.fillStyle = PARTICLE_CONFIG.ORANGE_COLOR;
     ctx.beginPath();
     ctx.arc(this.x, this.y, PARTICLE_CONFIG.CIRCLE_RADIUS, 0, Math.PI * 2);
     ctx.fill();
   }
   
   ctx.restore();
 }

 update(deltaTime) {
   // Calculate spring force back to origin
   const dx = this.originX - this.x;
   const dy = this.originY - this.y;
   const springForceX = dx * this.springStrength;
   const springForceY = dy * this.springStrength;

   // Apply spring force
   this.vx += springForceX * deltaTime;
   this.vy += springForceY * deltaTime;

   // Apply damping
   this.vx *= Math.pow(this.damping, deltaTime * 60);
   this.vy *= Math.pow(this.damping, deltaTime * 60);

   // Update position
   this.x += this.vx;
   this.y += this.vy;

   // Update activation based only on velocity, not mouse proximity
   this.activation *= 0.95; // Always fade out gradually
 }

 applyForce(fx, fy) {
   this.vx += fx;
   this.vy += fy;
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

 // Set up mouse tracking
 mouseMoveListener = (e) => {
   const currentTime = performance.now();
   const deltaTime = (currentTime - GLOBAL_STATE.lastMouseTime) / 1000;

   // Ignore events that are too close together (< 16ms) or too far apart (> 50ms)
   if (deltaTime < 0.016 || deltaTime > 0.05) {
     GLOBAL_STATE.lastMouseTime = currentTime;
     return;
   }

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

   // Calculate mouse velocity
   GLOBAL_STATE.mouseVX = (GLOBAL_STATE.mouseX - GLOBAL_STATE.lastMouseX) / deltaTime;
   GLOBAL_STATE.mouseVY = (GLOBAL_STATE.mouseY - GLOBAL_STATE.lastMouseY) / deltaTime;

   const maxVelocity = PARTICLE_CONFIG.MAX_MOUSE_VELOCITY;
   GLOBAL_STATE.mouseVX = Math.max(Math.min(GLOBAL_STATE.mouseVX, maxVelocity), -maxVelocity);
   GLOBAL_STATE.mouseVY = Math.max(Math.min(GLOBAL_STATE.mouseVY, maxVelocity), -maxVelocity);

   // Apply forces to particles along the mouse movement path
   const mouseSpeed = Math.sqrt(GLOBAL_STATE.mouseVX * GLOBAL_STATE.mouseVX + GLOBAL_STATE.mouseVY * GLOBAL_STATE.mouseVY);
   
   if (mouseSpeed > 0) {
     // Get normalized mouse movement direction
     const mvx = GLOBAL_STATE.mouseVX / mouseSpeed;
     const mvy = GLOBAL_STATE.mouseVY / mouseSpeed;
     const normalizedSpeed = Math.min(mouseSpeed / 1000, 1);

     // Line segment from previous to current mouse position
     const x1 = GLOBAL_STATE.lastMouseX;
     const y1 = GLOBAL_STATE.lastMouseY;
     const x2 = GLOBAL_STATE.mouseX;
     const y2 = GLOBAL_STATE.mouseY;
     
     // Line segment vector
     const lineVecX = x2 - x1;
     const lineVecY = y2 - y1;
     const lineLength = Math.sqrt(lineVecX * lineVecX + lineVecY * lineVecY);

     if (lineLength > 0) {
       GLOBAL_STATE.particles.forEach(particle => {
         // Calculate distance from particle to line segment
         const { distance, closestPoint } = pointToLineSegmentDistance(
           particle.x, particle.y, x1, y1, x2, y2
         );

         if (distance < PARTICLE_CONFIG.PATH_FORCE_RADIUS) {
           // Calculate force factor based on distance from path
           const distanceFactor = Math.pow(1 - distance / PARTICLE_CONFIG.PATH_FORCE_RADIUS, 1.5);
           
           // Apply force in mouse movement direction
           const forceStrength = distanceFactor * normalizedSpeed * PARTICLE_CONFIG.MOVEMENT_FORCE_MULTIPLIER * PARTICLE_CONFIG.BASE_PUSH_FORCE;
           const fx = mvx * forceStrength;
           const fy = mvy * forceStrength;
           
           particle.applyForce(fx, fy);
         }
       });
     }
   }

   // Add debug mouse position tracking
   if (PARTICLE_CONFIG.DEBUG_MOUSE_TRACKING) {
     GLOBAL_STATE.debugMousePositions.push({
       x: GLOBAL_STATE.mouseX,
       y: GLOBAL_STATE.mouseY,
       time: currentTime
     });
     
     // Limit the number of debug dots
     if (GLOBAL_STATE.debugMousePositions.length > PARTICLE_CONFIG.DEBUG_MAX_DOTS) {
       GLOBAL_STATE.debugMousePositions.shift();
     }
   }

   GLOBAL_STATE.lastMouseX = GLOBAL_STATE.mouseX;
   GLOBAL_STATE.lastMouseY = GLOBAL_STATE.mouseY;
   GLOBAL_STATE.lastMouseTime = currentTime;
 };

 document.addEventListener('mousemove', mouseMoveListener, { passive: true });

 // Handle resize
  resizeListener = () => {
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
      
      // Fixed opacity for all particles
      particle.baseOpacity = PARTICLE_CONFIG.MAX_OPACITY;
      
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

     // Update particles (just physics, no mouse forces)
     GLOBAL_STATE.particles.forEach(particle => {
       particle.update(deltaTime);
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

// Check if the page should show particles (.landing-root exists)
function shouldShowParticles() {
 return document.querySelector('.landing-root') !== null;
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
