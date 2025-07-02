//// Configuration object for all particle behavior constants
//const PARTICLE_CONFIG = {
//  // Particle appearance
//  CANVAS_SIZE: 40,
//  CONTAINER_HEIGHT: 1400,
//  BASE_OPACITY: 0.08,
//  ORANGE_COLOR: '#ff4f00',
//
//  // Velocity thresholds
//  MIN_VELOCITY_THRESHOLD: 2,
//  MAX_VELOCITY_THRESHOLD: 10,
//  MAX_VELOCITY: 100,
//
//  // Particle physics
//  DAMPING: 0.975,
//  MASS: 0.25,
//  SPRING_STRENGTH: 0.05,
//  ROTATION_SPEED: 0.01,
//  MAX_ROTATIONAL_VELOCITY: 0.5,
//
//  // Distribution
//  PARTICLE_COUNT: 1000,
//  BASE_RADIUS: 900,
//  RADIUS_STD_DEV: 200,
//
//  // Mouse interaction
//  FORCE_RADIUS: 300,
//  BASE_PUSH_FORCE: 0.001,
//  MOVEMENT_FORCE_MULTIPLIER: 1.2,
//  REPEL_FORCE_RATIO: 0.3,
//  MOVEMENT_FORCE_RATIO: 1.2,
//  MAX_MOUSE_VELOCITY: 5000,
//
//  // Animation
//  TARGET_FPS: 60,
//  MAX_FRAME_TIME: 0.1, // seconds
//};
//
//// Global particle state
//const GLOBAL_STATE = {
//  // Particle canvases
//  particleCanvases: {},
//
//  // Particles array
//  particles: [],
//
//  // Animation reference
//  animationFrameId: null,
//
//  // Current animation state
//  active: false,
//
//  // Time tracking
//  lastFrameTime: 0,
//
//  // Mouse tracking variables
//  mouseX: 0,
//  mouseY: 0,
//  lastMouseX: 0,
//  lastMouseY: 0,
//  mouseVX: 0,
//  mouseVY: 0,
//  lastMouseTime: 0
//};
//
//// Canvas and context references
//let canvas = null;
//let ctx = null;
//
//// Global DOM elements
//let wrapper = null;
//let mouseMoveListener = null;
//let resizeListener = null;
//
//// Private Particle class
//class Particle {
//  static CANVAS_SIZE = PARTICLE_CONFIG.CANVAS_SIZE;
//  static CONTAINER_HEIGHT = PARTICLE_CONFIG.CONTAINER_HEIGHT;
//  static PARTICLE_RADIUS = PARTICLE_CONFIG.CANVAS_SIZE / 6;
//  static SHAPES = ['circle', 'square', 'triangle'];
//  static BASE_OPACITY = PARTICLE_CONFIG.BASE_OPACITY;
//  static ORANGE_COLOR = PARTICLE_CONFIG.ORANGE_COLOR;
//  static MIN_VELOCITY_THRESHOLD = PARTICLE_CONFIG.MIN_VELOCITY_THRESHOLD;
//  static MAX_VELOCITY_THRESHOLD = PARTICLE_CONFIG.MAX_VELOCITY_THRESHOLD;
//
//  static initParticleCanvases() {
//    // Create offscreen canvases for each particle shape
//    Particle.SHAPES.forEach(shape => {
//      // Create white version
//      const whiteCanvas = document.createElement('canvas');
//      whiteCanvas.width = Particle.CANVAS_SIZE;
//      whiteCanvas.height = Particle.CANVAS_SIZE;
//      const whiteCtx = whiteCanvas.getContext('2d');
//      whiteCtx.fillStyle = 'white';
//      whiteCtx.globalAlpha = 1.0;
//
//      // Create orange version
//      const orangeCanvas = document.createElement('canvas');
//      orangeCanvas.width = Particle.CANVAS_SIZE;
//      orangeCanvas.height = Particle.CANVAS_SIZE;
//      const orangeCtx = orangeCanvas.getContext('2d');
//      orangeCtx.fillStyle = Particle.ORANGE_COLOR;
//      orangeCtx.globalAlpha = 1.0;
//
//      // Draw the shape on both canvases
//      [whiteCtx, orangeCtx].forEach(ctx => {
//        switch (shape) {
//          case 'circle':
//            ctx.beginPath();
//            ctx.arc(Particle.CANVAS_SIZE/2, Particle.CANVAS_SIZE/2, Particle.PARTICLE_RADIUS, 0, Math.PI * 2);
//            ctx.fill();
//            break;
//
//          case 'square':
//            const size = Particle.PARTICLE_RADIUS * 2;
//            ctx.fillRect(
//              Particle.CANVAS_SIZE/2 - Particle.PARTICLE_RADIUS,
//              Particle.CANVAS_SIZE/2 - Particle.PARTICLE_RADIUS,
//              size,
//              size
//            );
//            break;
//
//          case 'triangle':
//            const height = Particle.PARTICLE_RADIUS * 2;
//            const halfWidth = Particle.PARTICLE_RADIUS;
//            ctx.beginPath();
//            ctx.moveTo(Particle.CANVAS_SIZE/2, Particle.CANVAS_SIZE/2 - height/2);
//            ctx.lineTo(Particle.CANVAS_SIZE/2 - halfWidth, Particle.CANVAS_SIZE/2 + height/2);
//            ctx.lineTo(Particle.CANVAS_SIZE/2 + halfWidth, Particle.CANVAS_SIZE/2 + height/2);
//            ctx.closePath();
//            ctx.fill();
//            break;
//        }
//      });
//
//      if (!GLOBAL_STATE.particleCanvases[shape]) {
//        GLOBAL_STATE.particleCanvases[shape] = {};
//      }
//      GLOBAL_STATE.particleCanvases[shape].white = whiteCanvas;
//      GLOBAL_STATE.particleCanvases[shape].orange = orangeCanvas;
//    });
//  }
//
//  constructor() {    
//    this.shape = Particle.SHAPES[Math.floor(Math.random() * Particle.SHAPES.length)];
//    this.angle = Math.random() * Math.PI * 2; // Initial random angle
//    this.rotationSpeed = PARTICLE_CONFIG.ROTATION_SPEED;
//
//    // Add random rotation and rotational velocity
//    this.rotation = Math.random() * Math.PI * 2; // Random initial rotation
//    this.rotationalVelocity = (Math.random() - 0.5) * PARTICLE_CONFIG.MAX_ROTATIONAL_VELOCITY;
//
//    this.reset();
//  }
//
//  // Generate a normally distributed random number using Box-Muller transform
//  gaussianRandom(mean = 0, stdDev = 1) {
//    const u1 = Math.random();
//    const u2 = Math.random();
//    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
//    return z0 * stdDev + mean;
//  }
//
//  reset() {
//    // Circle parameters
//    const baseRadius = PARTICLE_CONFIG.BASE_RADIUS;
//    const stdDev = PARTICLE_CONFIG.RADIUS_STD_DEV;
//
//    // Generate random distance (but keep angle from constructor)
//    const randomDistance = this.gaussianRandom(0, stdDev);
//    this.radius = baseRadius + randomDistance;
//
//    // Convert polar to cartesian coordinates
//    this.updateOriginPosition();
//
//    // Current position
//    this.x = this.originX;
//    this.y = this.originY;
//
//    // Velocity (starts at 0)
//    this.vx = 0;
//    this.vy = 0;
//
//    // Physics constants
//    this.damping = PARTICLE_CONFIG.DAMPING;
//    this.mass = PARTICLE_CONFIG.MASS;
//    this.springStrength = PARTICLE_CONFIG.SPRING_STRENGTH;
//
//    // Size and opacity
//    this.size = Particle.PARTICLE_RADIUS * 2;
//    this.opacity = 1;
//    this.opacityFactor = Math.random();
//    this.opacityBase = Math.min(0, Math.random() - 0.5);
//  }
//
//  updateOriginPosition() {
//    const centerX = window.innerWidth / 2;
//    const centerY = 180;
//    this.originX = centerX + this.radius * Math.cos(this.angle);
//    this.originY = centerY + this.radius * Math.sin(this.angle);
//  }
//
//  draw(ctx) {
//    // Skip rendering if particle is outside canvas bounds
//    if (this.x + Particle.CANVAS_SIZE/2 < 0 || 
//        this.x - Particle.CANVAS_SIZE/2 > ctx.canvas.width ||
//        this.y + Particle.CANVAS_SIZE/2 < 0 || 
//        this.y - Particle.CANVAS_SIZE/2 > ctx.canvas.height) {
//      return;
//    }
//
//    // Calculate opacity based on distance from center
//    const centerX = window.innerWidth / 2;
//    const centerY = 180;
//    const dx = this.x - centerX;
//    const dy = this.y - centerY;
//    const distance = Math.sqrt(dx * dx + dy * dy);
//
//    // Fade out between 600px and 1200px from center
//    const minDistance = 600;
//    const maxDistance = 1200;
//    this.opacity = this.opacityBase + Math.max(0, Math.min(1, 1 - (distance - minDistance) / (maxDistance - minDistance))) * this.opacityFactor;
//
//    // Calculate velocity magnitude directly - simpler and more accurate
//    const velocityMagnitude = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
//
//    // Calculate color mix based on velocity - lowered threshold for more visible effect
//    const colorMix = Math.min(1, (velocityMagnitude - Particle.MIN_VELOCITY_THRESHOLD) / (Particle.MAX_VELOCITY_THRESHOLD - Particle.MIN_VELOCITY_THRESHOLD) * 0.5);
//
//    // Save the current context state
//    ctx.save();
//
//    // Translate to particle position and rotate
//    ctx.translate(this.x, this.y);
//    ctx.rotate(this.rotation);
//
//    // Draw white (base) particle
//    if (this.opacity > 0) {
//      ctx.globalAlpha = this.opacity * Particle.BASE_OPACITY * (1 - colorMix);
//      ctx.drawImage(
//        GLOBAL_STATE.particleCanvases[this.shape].white,
//        -Particle.CANVAS_SIZE/2,
//        -Particle.CANVAS_SIZE/2
//      );
//    }
//
//    // Draw orange (active) particle
//    if (colorMix > 0) {
//      // Ignore this.opacity since any fast particle will turn orange
//      ctx.globalAlpha = colorMix;
//      ctx.drawImage(
//        GLOBAL_STATE.particleCanvases[this.shape].orange,
//        -Particle.CANVAS_SIZE/2,
//        -Particle.CANVAS_SIZE/2
//      );
//    }
//
//    // Restore the context state
//    ctx.restore();
//    ctx.globalAlpha = 1;
//  }
//
//  update(deltaTime) {
//    // Update the angle
//    this.angle += this.rotationSpeed * deltaTime;
//    if (this.angle > Math.PI * 2) {
//      this.angle -= Math.PI * 2;
//    }
//
//    // Update rotation
//    this.rotation += this.rotationalVelocity * deltaTime;
//    if (this.rotation > Math.PI * 2) {
//      this.rotation -= Math.PI * 2;
//    }
//
//    // Update origin position based on new angle
//    this.updateOriginPosition();
//
//    // Calculate spring force back to origin
//    const dx = this.originX - this.x;
//    const dy = this.originY - this.y;
//    const springForceX = dx * this.springStrength;
//    const springForceY = dy * this.springStrength;
//
//    // Apply spring force (scaled by deltaTime)
//    this.vx += springForceX * deltaTime;
//    this.vy += springForceY * deltaTime;
//
//    // Apply damping
//    this.vx *= Math.pow(this.damping, deltaTime * 60);
//    this.vy *= Math.pow(this.damping, deltaTime * 60);
//
//    // Clamp velocity to prevent extreme speeds
//    const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
//    if (currentSpeed > 1000) {
//      this.vx = (this.vx / currentSpeed) * 1000;
//      this.vy = (this.vy / currentSpeed) * 1000;
//    }
//
//    // Update position
//    this.x += this.vx;
//    this.y += this.vy;
//  }
//
//  applyForce(fx, fy) {
//    this.vx += fx;
//    this.vy += fy;
//  }
//}
//
//// Create the particle system and initialize everything needed
//function createParticleSystem() {
//  console.log("[Particles] Creating particle system");
//
//  if (GLOBAL_STATE.active) {
//    console.log("[Particles] System already active, skipping creation");
//    return; // Already active
//  }
//
//  // Initialize particle canvases if needed
//  if (Object.keys(GLOBAL_STATE.particleCanvases).length === 0) {
//    Particle.initParticleCanvases();
//  }
//
//  // Create particles if needed
//  if (GLOBAL_STATE.particles.length === 0) {
//    console.log("[Particles] Creating particles");
//    GLOBAL_STATE.particles = Array.from({ length: PARTICLE_CONFIG.PARTICLE_COUNT }, () => new Particle());
//  }
//
//  // Create wrapper element
//  wrapper = document.createElement('div');
//  wrapper.setAttribute('data-particle-wrapper', 'true');
//  Object.assign(wrapper.style, {
//    position: 'absolute',
//    top: '0',
//    left: '0',
//    width: '100%',
//    height: `${Particle.CONTAINER_HEIGHT}px`,
//    overflow: 'hidden',
//    pointerEvents: 'none',
//    zIndex: '-1'
//  });
//
//  // Create canvas
//  canvas = document.createElement('canvas');
//  canvas.setAttribute('data-particles', 'true');
//  Object.assign(canvas.style, {
//    position: 'absolute',
//    top: '0',
//    left: '0',
//    width: '100%',
//    height: `${Particle.CONTAINER_HEIGHT}px`,
//    pointerEvents: 'none',
//    zIndex: '-1'
//  });
//
//  // Set canvas size
//  canvas.width = window.innerWidth;
//  canvas.height = Particle.CONTAINER_HEIGHT;
//
//  // Get context
//  ctx = canvas.getContext('2d');
//
//  // Add canvas to wrapper
//  wrapper.appendChild(canvas);
//
//  // Add wrapper to body
//  if (document.body.firstChild) {
//    document.body.insertBefore(wrapper, document.body.firstChild);
//  } else {
//    document.body.appendChild(wrapper);
//  }
//
//  // Set up mouse tracking
//  mouseMoveListener = (e) => {
//    const currentTime = performance.now();
//    const deltaTime = (currentTime - GLOBAL_STATE.lastMouseTime) / 1000;
//
//    // Use page coordinates for absolute positioning
//    GLOBAL_STATE.mouseX = e.pageX;
//    GLOBAL_STATE.mouseY = e.pageY;
//
//    if (deltaTime > 0) {
//      GLOBAL_STATE.mouseVX = (GLOBAL_STATE.mouseX - GLOBAL_STATE.lastMouseX) / deltaTime;
//      GLOBAL_STATE.mouseVY = (GLOBAL_STATE.mouseY - GLOBAL_STATE.lastMouseY) / deltaTime;
//
//      const maxVelocity = PARTICLE_CONFIG.MAX_MOUSE_VELOCITY;
//      GLOBAL_STATE.mouseVX = Math.max(Math.min(GLOBAL_STATE.mouseVX, maxVelocity), -maxVelocity);
//      GLOBAL_STATE.mouseVY = Math.max(Math.min(GLOBAL_STATE.mouseVY, maxVelocity), -maxVelocity);
//    }
//
//    GLOBAL_STATE.lastMouseX = GLOBAL_STATE.mouseX;
//    GLOBAL_STATE.lastMouseY = GLOBAL_STATE.mouseY;
//    GLOBAL_STATE.lastMouseTime = currentTime;
//  };
//
//  document.addEventListener('mousemove', mouseMoveListener);
//
//  // Handle resize
//  resizeListener = () => {
//    if (canvas) {
//      canvas.width = window.innerWidth;
//      canvas.height = Particle.CONTAINER_HEIGHT;
//      GLOBAL_STATE.particles.forEach(particle => particle.reset());
//    }
//  };
//
//  window.addEventListener('resize', resizeListener);
//
//  // Initialize timing
//  GLOBAL_STATE.lastFrameTime = performance.now();
//  GLOBAL_STATE.lastMouseTime = performance.now();
//
//  // Start animation
//  startAnimation();
//
//  // Mark as active
//  GLOBAL_STATE.active = true;
//}
//
//// Start the animation loop
//function startAnimation() {
//  if (GLOBAL_STATE.animationFrameId !== null) {
//    // Animation already running
//    return;
//  }
//
//  console.log("[Particles] Starting animation");
//
//  const TARGET_FPS = PARTICLE_CONFIG.TARGET_FPS;
//  const FRAME_TIME = 1000 / TARGET_FPS;
//  const FORCE_RADIUS = PARTICLE_CONFIG.FORCE_RADIUS;
//
//  function animate() {
//    const currentTime = performance.now();
//    const timeSinceLastFrame = currentTime - GLOBAL_STATE.lastFrameTime;
//
//    // Only render if enough time has passed for next frame
//    if (timeSinceLastFrame >= FRAME_TIME) {
//      const deltaTime = Math.min(timeSinceLastFrame / 1000, PARTICLE_CONFIG.MAX_FRAME_TIME);
//      GLOBAL_STATE.lastFrameTime = currentTime;
//
//      // Update all particles
//      GLOBAL_STATE.particles.forEach(particle => {
//        const dx = particle.x - GLOBAL_STATE.mouseX;
//        const dy = particle.y - GLOBAL_STATE.mouseY;
//        const distance = Math.sqrt(dx * dx + dy * dy);
//
//        if (distance < FORCE_RADIUS) {
//          // Calculate mouse velocity magnitude
//          const mouseSpeed = Math.sqrt(GLOBAL_STATE.mouseVX * GLOBAL_STATE.mouseVX + GLOBAL_STATE.mouseVY * GLOBAL_STATE.mouseVY);
//          // Normalize mouse velocity to 0-1 range
//          const normalizedSpeed = Math.min(mouseSpeed / PARTICLE_CONFIG.MAX_VELOCITY, 1);
//
//          // Calculate base force factor with smoother distance falloff
//          const forceFactor = Math.pow(1 - distance / FORCE_RADIUS, 1.5) *
//                          normalizedSpeed * 
//                          PARTICLE_CONFIG.BASE_PUSH_FORCE * 
//                          PARTICLE_CONFIG.MOVEMENT_FORCE_MULTIPLIER * 
//                          deltaTime * 60;
//
//          // Calculate repulsion direction (away from mouse)
//          const repelDirX = dx / distance;
//          const repelDirY = dy / distance;
//
//          // Get normalized mouse movement direction
//          const mvx = GLOBAL_STATE.mouseVX / (mouseSpeed || 1);
//          const mvy = GLOBAL_STATE.mouseVY / (mouseSpeed || 1);
//
//          // Calculate movement influence based on distance
//          const movementInfluence = Math.pow(1 - distance / FORCE_RADIUS, 1.2);
//
//          // Combine forces with reduced repulsion and increased movement
//          const repelForce = PARTICLE_CONFIG.REPEL_FORCE_RATIO * mouseSpeed;
//          const moveForce = mouseSpeed * PARTICLE_CONFIG.MOVEMENT_FORCE_RATIO;
//
//          // More emphasis on movement direction, less on repulsion
//          const fx = (repelDirX * repelForce * 0.5 + mvx * moveForce) * forceFactor * movementInfluence;
//          const fy = (repelDirY * repelForce * 0.5 + mvy * moveForce) * forceFactor * movementInfluence;
//
//          particle.applyForce(fx, fy);
//        }
//
//        particle.update(deltaTime);
//      });
//
//      // Make sure canvas and context exist before drawing
//      if (canvas && ctx) {
//        // Clear canvas
//        ctx.clearRect(0, 0, canvas.width, canvas.height);
//
//        // Draw particles
//        GLOBAL_STATE.particles.forEach(particle => {
//          particle.draw(ctx);
//        });
//      }
//    }
//
//    // Continue animation
//    GLOBAL_STATE.animationFrameId = requestAnimationFrame(animate);
//  }
//
//  GLOBAL_STATE.animationFrameId = requestAnimationFrame(animate);
//}
//
//// Completely destroy the particle system
//function destroyParticleSystem() {
//  console.log("[Particles] Destroying particle system");
//
//  // Cancel animation frame
//  if (GLOBAL_STATE.animationFrameId !== null) {
//    cancelAnimationFrame(GLOBAL_STATE.animationFrameId);
//    GLOBAL_STATE.animationFrameId = null;
//  }
//
//  // Remove event listeners
//  if (mouseMoveListener) {
//    document.removeEventListener('mousemove', mouseMoveListener);
//    mouseMoveListener = null;
//  }
//
//  if (resizeListener) {
//    window.removeEventListener('resize', resizeListener);
//    resizeListener = null;
//  }
//
//  // Remove DOM elements
//  if (wrapper && document.body.contains(wrapper)) {
//    wrapper.remove();
//  }
//
//  // Clear references
//  canvas = null;
//  ctx = null;
//  wrapper = null;
//
//  // Mark as inactive
//  GLOBAL_STATE.active = false;
//}
//
//// Check if the page should show particles (.landing-root exists)
//function shouldShowParticles() {
//  return document.querySelector('.landing-root') !== null;
//}
//
//// Handle mutation observer updates
//function observerInitialize() {
//  // Check if we should show or hide particles
//  if (shouldShowParticles()) {
//    if (!GLOBAL_STATE.active) {
//      console.log("[Particles] Landing page detected - creating particles");
//      createParticleSystem();
//    }
//  } else {
//    if (GLOBAL_STATE.active) {
//      console.log("[Particles] Not a landing page - destroying particles");
//      destroyParticleSystem();
//    }
//  }
//
//  // Mark all containers as initialized
//  document.querySelectorAll('.particle-container:not([data-particle-initialized])').forEach(container => {
//    container.setAttribute('data-particle-initialized', 'true');
//  });
//}
//
//// Compatibility function for observer-manager.js
//function initializeAllParticles() {
//  observerInitialize();
//}
//
//// Initialize after a small delay
////setTimeout(observerInitialize, 50);
