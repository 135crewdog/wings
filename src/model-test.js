// TEMPORARY: loads the test cube from Blender and draws it over the sky.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 5, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(6, 5, 9); camera.lookAt(1.5, 0.5, 0);
new GLTFLoader().load('./models/test.glb', (gltf) => {
  scene.add(gltf.scene);
  const meshes = []; gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o.name); });
  window.modelTest = { meshes };
  renderer.render(scene, camera);
}, undefined, (error) => { window.modelTest = { error: String(error) }; });
