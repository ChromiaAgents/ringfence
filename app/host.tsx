// The room's AI host: a VRM 3D character (three-vrm) that blinks, sways and lip-syncs to its own voice.
// speak(url) plays a WAV and drives the mouth from its loudness. Free and open source; runs in the browser.
// Model: VRM1_Constraint_Twist_Sample, (c) 2022 pixiv Inc., VRM Public License 1.0 (vrm.dev/licenses/1.0).
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';

export type HostHandle = { speak: (url: string) => Promise<void>; unlock: () => void };

export const Host = forwardRef<HostHandle, { className?: string; onTap?: () => void }>(function Host({ className, onTap }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [pct, setPct] = useState(0); // the character download, for the splash
  const [failed, setFailed] = useState(false);
  const level = useRef(0);
  const look = useRef({ x: 0, y: 0 }); // where a finger or the mouse is, -1..1: she turns toward it // 0..1 mouth opening, set by the audio analyser
  const audio = useRef<{ ctx?: AudioContext; busy: boolean }>({ busy: false });

  const poke = useRef(0); // when the character was last tapped: a happy reaction for a moment
  useImperativeHandle(ref, () => ({
    // Safari plays sound only from an AudioContext made and resumed inside a tap: call this from the tap.
    unlock() {
      const a = audio.current;
      a.ctx ??= new AudioContext();
      a.ctx.resume().catch(() => {});
      const b = a.ctx.createBuffer(1, 1, 22050), src = a.ctx.createBufferSource(); src.buffer = b; src.connect(a.ctx.destination); src.start();
    },
    async speak(url: string) {
      const a = audio.current;
      if (a.busy) return;
      a.busy = true;
      try {
        a.ctx ??= new AudioContext();
        if (a.ctx.state === 'suspended') await a.ctx.resume().catch(() => {});
        const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => a.ctx!.decodeAudioData(b));
        const src = a.ctx.createBufferSource(), an = a.ctx.createAnalyser();
        an.fftSize = 512; src.buffer = buf; src.connect(an); an.connect(a.ctx.destination);
        const data = new Uint8Array(an.fftSize);
        let on = true;
        const read = () => { if (!on) return; an.getByteTimeDomainData(data); let s = 0; for (const v of data) s += ((v - 128) / 128) ** 2; level.current = Math.min(1, Math.sqrt(s / data.length) * 6); requestAnimationFrame(read); };
        src.start(); read();
        await new Promise((ok) => (src.onended = ok));
        on = false; level.current = 0;
      } catch { /* no audio (autoplay blocked or TTS down): the character just stays idle */ } finally { a.busy = false; }
    },
  }));

  useEffect(() => {
    let stop = false, raf = 0, cleanup = () => {};
    (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
      const el = box.current; if (!el || stop) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio)); // sharp edges on phones; 30 fps keeps it light
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
      camera.position.set(0, 1.38, 1.55);
      scene.add(new THREE.DirectionalLight(0xffffff, Math.PI * 0.9).translateX(1).translateY(2).translateZ(2));
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const loader = new GLTFLoader();
      loader.register((p: any) => new VRMLoaderPlugin(p));
      const gltf: any = await loader.loadAsync('/brand/host.vrm', (e: ProgressEvent) => e.total && setPct(Math.round((e.loaded / e.total) * 100)));
      if (stop) return;
      const vrm = gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons?.(gltf.scene);
      vrm.scene.rotation.y = Math.PI; // VRM 0 faces -Z; VRM 1 the sample faces the camera after this
      if (vrm.meta?.metaVersion === '1') vrm.scene.rotation.y = 0;
      scene.add(vrm.scene);
      setReady(true);
      const h = vrm.humanoid;
      // Arms down from the T-pose.
      const set = (bone: string, z: number) => { const b = h?.getNormalizedBoneNode(bone); if (b) b.rotation.z = z; };
      set('leftUpperArm', -1.2); set('rightUpperArm', 1.2); set('leftLowerArm', -0.15); set('rightLowerArm', 0.15);
      const size = () => { const w = el.clientWidth, hh = el.clientHeight; renderer.setSize(w, hh); camera.aspect = w / hh;
        // Narrow phone screens: step back so the head and shoulders fit the width.
        camera.position.z = camera.aspect < 0.75 ? 1.55 + (0.75 - camera.aspect) * 2.4 : 1.55; camera.position.y = camera.aspect < 0.75 ? 1.32 : 1.38; camera.updateProjectionMatrix(); };
      size(); const ro = new ResizeObserver(size); ro.observe(el);
      const clock = new THREE.Clock();
      let nextBlink = 2, mouth = 0, acc = 0, onScreen = true;
      const lookS = { x: 0, y: 0 };
      const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }); io.observe(el);
      // 30 fps, and nothing at all while the tab is hidden: smooth on weak phones, cool laptops.
      const loop = () => {
        if (stop) return;
        raf = requestAnimationFrame(loop);
        if (document.hidden) { clock.getDelta(); return; }
        acc += clock.getDelta();
        // 30 fps while talking or just tapped, 15 when idle, none when off screen: keeps phones cool.
        const busy = mouth > 0.02 || performance.now() - poke.current < 1500 || ((window as any).__rfVoiceLevel?.() ?? 0) > 0.02;
        if (!onScreen || acc < 1 / (busy ? 30 : 15)) return;
        const dt = Math.min(acc, 0.1); acc = 0;
        const t = clock.elapsedTime;
        // Ease toward the finger: about a third of a second, so the head turns, not snaps.
        lookS.x += (look.current.x - lookS.x) * Math.min(1, dt * 3); lookS.y += (look.current.y - lookS.y) * Math.min(1, dt * 3);
        // Its own lines, or the call agent's voice when a call is on (one voice, one face).
        const call = (window as any).__rfVoiceLevel?.() ?? 0;
        mouth += (Math.max(level.current, call) - mouth) * Math.min(1, dt * 18);
        const em = vrm.expressionManager;
        em?.setValue('aa', mouth);
        em?.setValue('ih', mouth * 0.3);
        const tapped = Math.max(0, 1 - (performance.now() - poke.current) / 1500);
        em?.setValue('happy', Math.min(1, 0.25 + mouth * 0.2 + tapped));
        if (t > nextBlink) { em?.setValue('blink', 1); if (t > nextBlink + 0.12) { em?.setValue('blink', 0); nextBlink = t + 2 + Math.random() * 3; } }
        const head = h?.getNormalizedBoneNode('head'), spine = h?.getNormalizedBoneNode('spine');
        if (head) { head.rotation.y = Math.sin(t * 0.6) * 0.12 + lookS.x * 0.3; head.rotation.x = Math.sin(t * 0.9) * 0.04 + mouth * 0.06 - lookS.y * 0.15 + tapped * 0.12; }
        if (spine) spine.rotation.z = Math.sin(t * 0.7) * 0.03;
        vrm.update(dt);
        renderer.render(scene, camera);
      };
      loop();
      cleanup = () => { io.disconnect(); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); };
    })().catch((e) => { console.warn('host', e); setFailed(true); });
    return () => { stop = true; cancelAnimationFrame(raf); cleanup(); };
  }, []);

  // A still of the host shows at once; the 3D character replaces it when loaded (about 4 MB, cached after).
  return <div ref={box} className={className} aria-label="Ringfence host, an animated character" role="img"
    onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); look.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 }; }}
    onPointerLeave={() => (look.current = { x: 0, y: 0 })}
    onPointerDown={() => { poke.current = performance.now(); onTap?.(); }}
    style={{ touchAction: 'manipulation', cursor: 'pointer',  backgroundImage: ready ? undefined : 'url(/brand/host.jpg)', backgroundSize: 'cover', backgroundPosition: 'center top' }}>
    <div className={`host-splash${ready || failed ? ' done' : ''}`} aria-hidden="true">
      <img src="/brand/near-mark-light.svg" alt="" width={44} height={44} />
      <b>Ringfence</b>
      <span>Going live… {pct > 0 && pct < 100 ? `${pct}%` : ''}</span>
      <i style={{ transform: `scaleX(${Math.max(0.05, pct / 100)})` }} />
    </div>
  </div>;
});
