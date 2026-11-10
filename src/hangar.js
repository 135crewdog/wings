// The hangar view: the airplane hanging in the sky, to be looked at until
// first flight replaces this. Drag a finger to look around it; its gear,
// flaps and controls move by themselves in a slow repeating cycle.

import * as THREE from 'three';
import { createAircraft } from './render/aircraft.js';
import { demoAt } from './demo.js';

const DISTANCE = 26;             // m, camera to airplane
const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Starts the hangar view on a canvas. */
export function startHangar(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });   // the sky is the page behind it
  const scene = new THREE.Scene();
  // Sky above, a bright haze below so the underside can be seen, and a sun.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c8d8, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const glow = new THREE.DirectionalLight(0xdde8f4, 1.4);   // light off the haze, from below
  glow.position.set(-2, -5, -3);
  scene.add(glow);
  const airplane = createAircraft();
  scene.add(airplane);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 500);

  // Looking around: the camera rides a sphere about the airplane.
  let around = 35 * DEG, above = 12 * DEG, finger = null;
  const aim = () => {
    camera.position.set(DISTANCE * Math.sin(around) * Math.cos(above), DISTANCE * Math.sin(above), -DISTANCE * Math.cos(around) * Math.cos(above));
    camera.lookAt(0, 0, 0);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (finger) return;
    finger = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!finger || event.pointerId !== finger.id) return;
    // Dragging moves the airplane under the finger: drag right and it turns right.
    around -= ((event.clientX - finger.x) / canvas.clientHeight) * 3;
    above = clamp(above + ((event.clientY - finger.y) / canvas.clientHeight) * 3, -80 * DEG, 80 * DEG);
    finger.x = event.clientX; finger.y = event.clientY;
  });
  const lift = (event) => { if (finger && event.pointerId === finger.id) finger = null; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  const fit = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(fit).observe(canvas);
  fit();

  // Draw only while the app is on screen; the demo's clock stops with it.
  let seconds = 0, last = null;
  const frame = (now) => {
    if (document.hidden) { last = null; return; }
    if (last !== null) seconds += Math.min((now - last) / 1000, 0.1);
    last = now;
    airplane.set(demoAt(seconds));
    aim();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
  requestAnimationFrame(frame);
  return { airplane, ready: airplane.ready };
}
