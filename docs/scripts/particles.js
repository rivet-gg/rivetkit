// Configuration object for all particle behavior constants
const PARTICLE_CONFIG = {
 // Particle appearance
 CIRCLE_RADIUS: 3,
 BASE_OPACITY: 0.3,
 MAX_OPACITY: 0.8,

 // Grid layout
 GRID_SPACING: 40,

 // Animation
 TARGET_FPS: 60,
 MAX_FRAME_TIME: 0.1, // seconds
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
};

// Canvas and context references
let canvas = null;
let ctx = null;

// Global DOM elements
let wrapper = null;
let resizeListener = null;

// Simple Particle class for grid-based circles
class Particle {
 constructor(x, y) {
   this.x = x;
   this.y = y;
   this.opacity = 0;
 }

 draw(ctx) {
   if (this.opacity <= 0) return;
   
   ctx.save();
   ctx.globalAlpha = this.opacity;
   ctx.fillStyle = 'white';
   ctx.beginPath();
   ctx.arc(this.x, this.y, PARTICLE_CONFIG.CIRCLE_RADIUS, 0, Math.PI * 2);
   ctx.fill();
   ctx.restore();
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
      
      // Calculate distance from center for opacity
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
      
      // Opacity increases from center (0) to border (max)
      particle.opacity = Math.min(PARTICLE_CONFIG.MAX_OPACITY, 
        (distance / maxDistance) * PARTICLE_CONFIG.MAX_OPACITY + PARTICLE_CONFIG.BASE_OPACITY);
      
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
     GLOBAL_STATE.lastFrameTime = currentTime;

     // Make sure canvas and context exist before drawing
     if (canvas && ctx) {
       // Clear canvas
       ctx.clearRect(0, 0, canvas.width, canvas.height);

       // Draw particles
       GLOBAL_STATE.particles.forEach(particle => {
         particle.draw(ctx);
       });
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
