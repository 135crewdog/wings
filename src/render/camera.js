// The chase camera: behind and a little above the airplane, turning with it
// a beat late, so the airplane stays upright on screen and the horizon tilts.
// After 135crewdog/rage, src/render/camera.js.

import * as THREE from 'three';

const BEHIND = 21, ABOVE = 4.2;     // m from the airplane's centre of gravity
const AHEAD = 18, AIM_ABOVE = 3.2; // where it looks: ahead of the airplane, so the airplane sits low on screen
const LAG = 0.12;                  // s: how late the camera follows a change of attitude
const CLEAR = 1.2;                 // m: the camera never goes lower than this above the ground

/** Returns { camera, reset(), update(position, quaternion, dt, groundY) }. */
export function createChaseCamera() {
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 30000);
  const q = new THREE.Quaternion(), offset = new THREE.Vector3(), aim = new THREE.Vector3();
  let first = true;
  return {
    camera,
    /** The next update snaps to the airplane instead of easing: for a new flight. */
    reset() { first = true; },
    update(position, quaternion, dt, groundY) {
      q.slerp(quaternion, first ? 1 : 1 - Math.exp(-dt / LAG));
      first = false;
      camera.position.copy(position).add(offset.set(0, ABOVE, BEHIND).applyQuaternion(q));
      camera.position.y = Math.max(camera.position.y, groundY + CLEAR);
      camera.up.set(0, 1, 0).applyQuaternion(q);
      camera.lookAt(aim.set(0, AIM_ABOVE, -AHEAD).applyQuaternion(q).add(position));
    },
  };
}
