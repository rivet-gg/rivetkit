// Configuration object for all particle behavior constants
const PARTICLE_CONFIG = {
  // Particle appearance
  CANVAS_SIZE: 40,
  CONTAINER_HEIGHT: 1400,
  BASE_OPACITY: 0.08,
  ORANGE_COLOR: '#ff4f00',
  
  // Velocity thresholds
  MIN_VELOCITY_THRESHOLD: 2,
  MAX_VELOCITY_THRESHOLD: 10,
  MAX_VELOCITY: 100,
  
  // Particle physics
  DAMPING: 0.975,
  MASS: 0.25,
  SPRING_STRENGTH: 0.05,
  ROTATION_SPEED: 0.01,
  MAX_ROTATIONAL_VELOCITY: 0.5,
  
  // Distribution
  PARTICLE_COUNT: 1000,
  BASE_RADIUS: 900,
  RADIUS_STD_DEV: 200,
  
  // Mouse interaction
  FORCE_RADIUS: 300,
  BASE_PUSH_FORCE: 0.001,
  MOVEMENT_FORCE_MULTIPLIER: 1.2,
  REPEL_FORCE_RATIO: 0.3,
  MOVEMENT_FORCE_RATIO: 1.2,
  MAX_MOUSE_VELOCITY: 5000,
  
  // Animation
  TARGET_FPS: 60,
  MAX_FRAME_TIME: 0.1 // seconds
};

// Private Particle class
class Particle {
  static particleCanvases = {};
  static CANVAS_SIZE = PARTICLE_CONFIG.CANVAS_SIZE;
  static CONTAINER_HEIGHT = PARTICLE_CONFIG.CONTAINER_HEIGHT;
  static PARTICLE_RADIUS = PARTICLE_CONFIG.CANVAS_SIZE / 6;
  static SHAPES = ['circle', 'square', 'triangle'];
  static BASE_OPACITY = PARTICLE_CONFIG.BASE_OPACITY;
  static ORANGE_COLOR = PARTICLE_CONFIG.ORANGE_COLOR;
  static MIN_VELOCITY_THRESHOLD = PARTICLE_CONFIG.MIN_VELOCITY_THRESHOLD;
  static MAX_VELOCITY_THRESHOLD = PARTICLE_CONFIG.MAX_VELOCITY_THRESHOLD;

  static initParticleCanvases() {
    // Create offscreen canvases for each particle shape
    Particle.SHAPES.forEach(shape => {
      // Create white version
      const whiteCanvas = document.createElement('canvas');
      whiteCanvas.width = Particle.CANVAS_SIZE;
      whiteCanvas.height = Particle.CANVAS_SIZE;
      const whiteCtx = whiteCanvas.getContext('2d');
      whiteCtx.fillStyle = 'white';
      whiteCtx.globalAlpha = 1.0;

      // Create orange version
      const orangeCanvas = document.createElement('canvas');
      orangeCanvas.width = Particle.CANVAS_SIZE;
      orangeCanvas.height = Particle.CANVAS_SIZE;
      const orangeCtx = orangeCanvas.getContext('2d');
      orangeCtx.fillStyle = Particle.ORANGE_COLOR;
      orangeCtx.globalAlpha = 1.0;

      // Draw the shape on both canvases
      [whiteCtx, orangeCtx].forEach(ctx => {
        switch (shape) {
          case 'circle':
            ctx.beginPath();
            ctx.arc(Particle.CANVAS_SIZE/2, Particle.CANVAS_SIZE/2, Particle.PARTICLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            break;
          
          case 'square':
            const size = Particle.PARTICLE_RADIUS * 2;
            ctx.fillRect(
              Particle.CANVAS_SIZE/2 - Particle.PARTICLE_RADIUS,
              Particle.CANVAS_SIZE/2 - Particle.PARTICLE_RADIUS,
              size,
              size
            );
            break;
          
          case 'triangle':
            const height = Particle.PARTICLE_RADIUS * 2;
            const halfWidth = Particle.PARTICLE_RADIUS;
            ctx.beginPath();
            ctx.moveTo(Particle.CANVAS_SIZE/2, Particle.CANVAS_SIZE/2 - height/2);
            ctx.lineTo(Particle.CANVAS_SIZE/2 - halfWidth, Particle.CANVAS_SIZE/2 + height/2);
            ctx.lineTo(Particle.CANVAS_SIZE/2 + halfWidth, Particle.CANVAS_SIZE/2 + height/2);
            ctx.closePath();
            ctx.fill();
            break;
        }
      });

      if (!Particle.particleCanvases[shape]) {
        Particle.particleCanvases[shape] = {};
      }
      Particle.particleCanvases[shape].white = whiteCanvas;
      Particle.particleCanvases[shape].orange = orangeCanvas;
    });
  }

  constructor() {
    // Initialize static canvases if not already done
    if (Object.keys(Particle.particleCanvases).length === 0) {
      Particle.initParticleCanvases();
    }
    
    this.shape = Particle.SHAPES[Math.floor(Math.random() * Particle.SHAPES.length)];
    this.angle = Math.random() * Math.PI * 2; // Initial random angle
    this.rotationSpeed = PARTICLE_CONFIG.ROTATION_SPEED;
    
    // Add random rotation and rotational velocity
    this.rotation = Math.random() * Math.PI * 2; // Random initial rotation
    this.rotationalVelocity = (Math.random() - 0.5) * PARTICLE_CONFIG.MAX_ROTATIONAL_VELOCITY;
    
    this.reset();
  }

  // Generate a normally distributed random number using Box-Muller transform
  gaussianRandom(mean = 0, stdDev = 1) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  reset() {
    // Circle parameters
    const baseRadius = PARTICLE_CONFIG.BASE_RADIUS;
    const stdDev = PARTICLE_CONFIG.RADIUS_STD_DEV;
    
    // Generate random distance (but keep angle from constructor)
    const randomDistance = this.gaussianRandom(0, stdDev);
    this.radius = baseRadius + randomDistance;
    
    // Convert polar to cartesian coordinates
    this.updateOriginPosition();
    
    // Current position
    this.x = this.originX;
    this.y = this.originY;
    
    // Velocity (starts at 0)
    this.vx = 0;
    this.vy = 0;
    
    // Physics constants
    this.damping = PARTICLE_CONFIG.DAMPING;
    this.mass = PARTICLE_CONFIG.MASS;
    this.springStrength = PARTICLE_CONFIG.SPRING_STRENGTH;
    
    // Size and opacity
    this.size = Particle.PARTICLE_RADIUS * 2;
    this.opacity = 1;
    this.opacityFactor = Math.random();
    this.opacityBase = Math.min(0, Math.random() - 0.5);
  }

  updateOriginPosition() {
    const centerX = window.innerWidth / 2;
    const centerY = 180;
    this.originX = centerX + this.radius * Math.cos(this.angle);
    this.originY = centerY + this.radius * Math.sin(this.angle);
  }

  draw(ctx) {
    // Skip rendering if particle is outside canvas bounds
    if (this.x + Particle.CANVAS_SIZE/2 < 0 || 
        this.x - Particle.CANVAS_SIZE/2 > ctx.canvas.width ||
        this.y + Particle.CANVAS_SIZE/2 < 0 || 
        this.y - Particle.CANVAS_SIZE/2 > ctx.canvas.height) {
      return;
    }

    // Calculate opacity based on distance from center
    const centerX = window.innerWidth / 2;
    const centerY = 180;
    const dx = this.x - centerX;
    const dy = this.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Fade out between 600px and 1200px from center
    const minDistance = 600;
    const maxDistance = 1200;
    this.opacity = this.opacityBase + Math.max(0, Math.min(1, 1 - (distance - minDistance) / (maxDistance - minDistance))) * this.opacityFactor;

    // Calculate velocity magnitude directly - simpler and more accurate
    const velocityMagnitude = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    
    // Calculate color mix based on velocity - lowered threshold for more visible effect
    const colorMix = Math.min(1, (velocityMagnitude - Particle.MIN_VELOCITY_THRESHOLD) / (Particle.MAX_VELOCITY_THRESHOLD - Particle.MIN_VELOCITY_THRESHOLD) * 0.5);
    
    // Save the current context state
    ctx.save();
    
    // Translate to particle position and rotate
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    // Draw white (base) particle
    if (this.opacity > 0) {
      ctx.globalAlpha = this.opacity * Particle.BASE_OPACITY * (1 - colorMix);
      ctx.drawImage(
        Particle.particleCanvases[this.shape].white,
        -Particle.CANVAS_SIZE/2,
        -Particle.CANVAS_SIZE/2
      );
    }

    // Draw orange (active) particle
    if (colorMix > 0) {
      // Ignore this.opacity since any fast particle will turn orange
      ctx.globalAlpha = colorMix;
      ctx.drawImage(
        Particle.particleCanvases[this.shape].orange,
        -Particle.CANVAS_SIZE/2,
        -Particle.CANVAS_SIZE/2
      );
    }
    
    // Restore the context state
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  update(deltaTime) {
    // Update the angle
    this.angle += this.rotationSpeed * deltaTime;
    if (this.angle > Math.PI * 2) {
      this.angle -= Math.PI * 2;
    }
    
    // Update rotation
    this.rotation += this.rotationalVelocity * deltaTime;
    if (this.rotation > Math.PI * 2) {
      this.rotation -= Math.PI * 2;
    }
    
    // Update origin position based on new angle
    this.updateOriginPosition();

    // Calculate spring force back to origin
    const dx = this.originX - this.x;
    const dy = this.originY - this.y;
    const springForceX = dx * this.springStrength;
    const springForceY = dy * this.springStrength;
    
    // Apply spring force (scaled by deltaTime)
    this.vx += springForceX * deltaTime;
    this.vy += springForceY * deltaTime;
    
    // Apply damping
    this.vx *= Math.pow(this.damping, deltaTime * 60);
    this.vy *= Math.pow(this.damping, deltaTime * 60);
    
    // Clamp velocity to prevent extreme speeds
    const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (currentSpeed > 1000) {
      this.vx = (this.vx / currentSpeed) * 1000;
      this.vy = (this.vy / currentSpeed) * 1000;
    }
    
    // Update position
    this.x += this.vx;
    this.y += this.vy;
  }

  applyForce(fx, fy) {
    this.vx += fx;
    this.vy += fy;
  }
}

// Debounce helper function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function initializeParticleBackground(container) {
  console.log("[Initialize] ParticleBackground", container?.id || "main");
  
  // Apply styles to container
  Object.assign(container.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: `${Particle.CONTAINER_HEIGHT}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1'
  });

  // Create canvas element
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas size
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  
  // Add canvas to container
  container.appendChild(canvas);
  
  const particles = Array.from({ length: PARTICLE_CONFIG.PARTICLE_COUNT }, () => new Particle());

  // Mouse tracking variables
  let mouseX = 0;
  let mouseY = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let mouseVX = 0;
  let mouseVY = 0;
  let lastMouseTime = performance.now();
  const FORCE_RADIUS = PARTICLE_CONFIG.FORCE_RADIUS;
  const BASE_PUSH_FORCE = PARTICLE_CONFIG.BASE_PUSH_FORCE;
  const MAX_VELOCITY = PARTICLE_CONFIG.MAX_VELOCITY;

  // Track mouse movement and calculate velocity
  document.addEventListener('mousemove', (e) => {
    const currentTime = performance.now();
    const deltaTime = (currentTime - lastMouseTime) / 1000;
    
    const canvasRect = canvas.getBoundingClientRect();
    
    // Since canvas is fixed in viewport, just use client coordinates
    mouseX = e.clientX - canvasRect.left;
    mouseY = e.clientY - canvasRect.top;
    
    if (deltaTime > 0) {
      mouseVX = (mouseX - lastMouseX) / deltaTime;
      mouseVY = (mouseY - lastMouseY) / deltaTime;
      
      const maxVelocity = PARTICLE_CONFIG.MAX_MOUSE_VELOCITY;
      mouseVX = Math.max(Math.min(mouseVX, maxVelocity), -maxVelocity);
      mouseVY = Math.max(Math.min(mouseVY, maxVelocity), -maxVelocity);
    }
    
    lastMouseX = mouseX;
    lastMouseY = mouseY;
    lastMouseTime = currentTime;
  });

  // Track scroll events - no need to update mouse position since canvas is fixed
  document.addEventListener('scroll', () => {
    // Just update the last scroll position for reference if needed
    lastScrollY = window.scrollY;
  });

  let lastFrameTime = performance.now();
  let animationFrameId = null;
  const TARGET_FPS = PARTICLE_CONFIG.TARGET_FPS;
  const FRAME_TIME = 1000 / TARGET_FPS;

  function animate() {
    const currentTime = performance.now();
    const timeSinceLastFrame = currentTime - lastFrameTime;

    // Only render if enough time has passed for next frame
    if (timeSinceLastFrame >= FRAME_TIME) {
      const deltaTime = Math.min(timeSinceLastFrame / 1000, PARTICLE_CONFIG.MAX_FRAME_TIME);
      lastFrameTime = currentTime;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach(particle => {
        const dx = particle.x - mouseX;
        const dy = particle.y - mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < FORCE_RADIUS) {
          // Calculate mouse velocity magnitude
          const mouseSpeed = Math.sqrt(mouseVX * mouseVX + mouseVY * mouseVY);
          // Normalize mouse velocity to 0-1 range
          const normalizedSpeed = Math.min(mouseSpeed / PARTICLE_CONFIG.MAX_VELOCITY, 1);
          
          // Calculate base force factor with smoother distance falloff
          const forceFactor = Math.pow(1 - distance / FORCE_RADIUS, 1.5) *
                            normalizedSpeed * 
                            PARTICLE_CONFIG.BASE_PUSH_FORCE * 
                            PARTICLE_CONFIG.MOVEMENT_FORCE_MULTIPLIER * 
                            deltaTime * 60;
          
          // Calculate repulsion direction (away from mouse)
          const repelDirX = dx / distance;
          const repelDirY = dy / distance;
          
          // Get normalized mouse movement direction
          const mvx = mouseVX / (mouseSpeed || 1);
          const mvy = mouseVY / (mouseSpeed || 1);
          
          // Calculate movement influence based on distance
          const movementInfluence = Math.pow(1 - distance / FORCE_RADIUS, 1.2);
          
          // Combine forces with reduced repulsion and increased movement
          const repelForce = PARTICLE_CONFIG.REPEL_FORCE_RATIO * mouseSpeed;
          const moveForce = mouseSpeed * PARTICLE_CONFIG.MOVEMENT_FORCE_RATIO;
          
          // More emphasis on movement direction, less on repulsion
          const fx = (repelDirX * repelForce * 0.5 + mvx * moveForce) * forceFactor * movementInfluence;
          const fy = (repelDirY * repelForce * 0.5 + mvy * moveForce) * forceFactor * movementInfluence;
          
          particle.applyForce(fx, fy);
        }
        
        particle.update(deltaTime);
        particle.draw(ctx);
      });
    }
    animationFrameId = requestAnimationFrame(animate);
  }

  // Create a disconnect observer to cleanup when container is removed
  const disconnectObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      for (const node of mutation.removedNodes) {
        if (node === container || (node.nodeType === 1 && node.contains(container))) {
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
          }
          disconnectObserver.disconnect();
          return;
        }
      }
    }
  });

  // Start observing the document for container removal with optimized config
  disconnectObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });

  animate();

  // Handle window resize with debouncing
  const debouncedResize = debounce(() => {
    resizeCanvas();
    particles.forEach(particle => particle.reset());
  }, 100); // 100ms debounce delay

  window.addEventListener('resize', debouncedResize);
}

// Setup observer to initialize particle containers when they appear
const particleObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList') continue;

    for (const node of mutation.addedNodes) {
      // Quick check for element nodes only
      if (node.nodeType !== 1) continue;

      // Direct class check is faster than matches()
      if (node.classList?.contains('particle-container')) {
        initializeParticleBackground(node);
        continue;
      }

      // Only query children if the node might contain particle containers
      if (node.getElementsByClassName) {
        const containers = node.getElementsByClassName('particle-container');
        for (let i = 0; i < containers.length; i++) {
          initializeParticleBackground(containers[i]);
        }
      }
    }
  }
});

// Start observing with optimized configuration
particleObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false
});

// Initialize existing particle containers
const existingContainers = document.getElementsByClassName('particle-container');
for (let i = 0; i < existingContainers.length; i++) {
  initializeParticleBackground(existingContainers[i]);
}

// Cleanup function
function cleanup() {
  particleObserver.disconnect();
}

// Add cleanup on page unload
window.addEventListener('unload', cleanup);

// Initialize existing particle containers
function initializeExistingParticles() {
  const containers = document.getElementsByClassName('particle-container');
  for (let i = 0; i < containers.length; i++) {
    initializeParticleBackground(containers[i]);
  }
}

// Initialize if already in DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeExistingParticles);
} else {
  initializeExistingParticles();
} 