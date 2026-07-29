import type { ZoneId, ZoneState } from '../workbenchTypes'

export type CosmosPlanetInput = {
  id: ZoneId
  state: ZoneState
  progress: number | null
}

export type CosmosHandle = {
  setHeroState: (state: ZoneState) => void
  setPlanets: (planets: CosmosPlanetInput[]) => void
  setHovered: (id: ZoneId | null) => void
  setPointer: (nx: number, ny: number, active: boolean) => void
  resize: (w: number, h: number) => void
  setAnimating: (on: boolean) => void
  dispose: () => void
}

const PLANET_PALETTE: Record<ZoneId, number> = {
  sessions: 0x6d6ae8, // indigo
  tasks: 0x3d9a50, // green
  automations: 0xd4893a, // amber
  knowledge: 0x2f8fd4, // sky
  terminals: 0x1aa8a8, // teal
  workflows: 0xa78bfa, // violet
}

const STATE_SUN: Record<ZoneState, number> = {
  idle: 0xd97757,
  running: 0xff6b2c,
  blocked: 0xe0a020,
  fail: 0xe04848,
  done: 0x4ade80,
}

/**
 * Mini solar system: starfield + sun + zone planets on orbits.
 * Hover list rows → highlight matching planet.
 */
export async function createCosmos(
  canvas: HTMLCanvasElement,
  opts: { animate: boolean; dark: boolean },
): Promise<CosmosHandle> {
  const THREE = await import('three')

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = opts.dark ? 1.15 : 0.95

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(opts.dark ? 0x050510 : 0xf0ebe6, opts.dark ? 0.035 : 0.05)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120)
  camera.position.set(0, 4.2, 9.5)
  camera.lookAt(0, 0, 0)

  const ambient = new THREE.AmbientLight(0xffffff, opts.dark ? 0.35 : 0.55)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xfff0e0, opts.dark ? 0.55 : 0.4)
  key.position.set(4, 8, 5)
  scene.add(key)

  // —— Starfield ——
  const STAR_N = 900
  const starPos = new Float32Array(STAR_N * 3)
  const starSize = new Float32Array(STAR_N)
  for (let i = 0; i < STAR_N; i++) {
    const r = 18 + Math.random() * 28
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55
    starPos[i * 3 + 2] = r * Math.cos(phi)
    starSize[i] = 0.5 + Math.random() * 1.5
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1))
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opts.dark ? 0.85 : 0.35 },
      uColor: {
        value: new THREE.Color(opts.dark ? 0xdce6ff : 0x8a7a6a),
      },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.65 + 0.35 * sin(uTime * 2.0 + position.x * 3.1 + position.z);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (180.0 / -mv.z) * vTwinkle;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d) * uOpacity * vTwinkle;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const stars = new THREE.Points(starGeo, starMat)
  scene.add(stars)

  // —— Asteroid belt dust ——
  const BELT_N = 280
  const beltPos = new Float32Array(BELT_N * 3)
  for (let i = 0; i < BELT_N; i++) {
    const ang = Math.random() * Math.PI * 2
    const rad = 3.6 + Math.random() * 0.9
    beltPos[i * 3] = Math.cos(ang) * rad
    beltPos[i * 3 + 1] = (Math.random() - 0.5) * 0.25
    beltPos[i * 3 + 2] = Math.sin(ang) * rad
  }
  const beltGeo = new THREE.BufferGeometry()
  beltGeo.setAttribute('position', new THREE.BufferAttribute(beltPos, 3))
  const beltMat = new THREE.PointsMaterial({
    color: opts.dark ? 0xc4b5a0 : 0xb0a090,
    size: 0.035,
    transparent: true,
    opacity: opts.dark ? 0.45 : 0.28,
    depthWrite: false,
  })
  const belt = new THREE.Points(beltGeo, beltMat)
  scene.add(belt)

  // —— Sun ——
  const sunGroup = new THREE.Group()
  scene.add(sunGroup)

  const sunGeo = new THREE.SphereGeometry(0.55, 48, 48)
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xff8c42,
    emissive: 0xc2410c,
    emissiveIntensity: 1.2,
    roughness: 0.45,
    metalness: 0.1,
  })
  const sun = new THREE.Mesh(sunGeo, sunMat)
  sunGroup.add(sun)

  // corona shells
  const coronaGeo = new THREE.SphereGeometry(0.72, 32, 32)
  const coronaMat = new THREE.MeshBasicMaterial({
    color: 0xff6b2c,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  })
  const corona = new THREE.Mesh(coronaGeo, coronaMat)
  sunGroup.add(corona)

  const corona2Geo = new THREE.SphereGeometry(0.95, 32, 32)
  const corona2Mat = new THREE.MeshBasicMaterial({
    color: 0xffaa66,
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
  })
  const corona2 = new THREE.Mesh(corona2Geo, corona2Mat)
  sunGroup.add(corona2)

  const sunLight = new THREE.PointLight(0xff8c42, 1.4, 24)
  sunGroup.add(sunLight)

  // —— Planets ——
  type PlanetRec = {
    id: ZoneId
    pivot: InstanceType<typeof THREE.Group>
    mesh: InstanceType<typeof THREE.Mesh>
    mat: InstanceType<typeof THREE.MeshStandardMaterial>
    ring?: InstanceType<typeof THREE.Mesh>
    orbitLine: InstanceType<typeof THREE.Line>
    radius: number
    speed: number
    phase: number
    baseScale: number
    state: ZoneState
  }

  const planets = new Map<ZoneId, PlanetRec>()
  const planetRoot = new THREE.Group()
  scene.add(planetRoot)

  function makeOrbitGeometry(radius: number) {
    const pts: InstanceType<typeof THREE.Vector3>[] = []
    const seg = 96
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }

  function syncPlanets(list: CosmosPlanetInput[]) {
    for (const [id, rec] of planets) {
      if (!list.some((p) => p.id === id)) {
        planetRoot.remove(rec.pivot)
        planetRoot.remove(rec.orbitLine)
        rec.mesh.geometry.dispose()
        rec.mat.dispose()
        rec.orbitLine.geometry.dispose()
        ;(rec.orbitLine.material as InstanceType<typeof THREE.Material>).dispose()
        rec.ring?.geometry.dispose()
        if (rec.ring) (rec.ring.material as InstanceType<typeof THREE.Material>).dispose()
        planets.delete(id)
      }
    }

    const n = Math.max(list.length, 1)
    list.forEach((p, i) => {
      const radius = 1.55 + i * 0.72
      const color = PLANET_PALETTE[p.id] ?? 0x888888
      let rec = planets.get(p.id)
      if (!rec) {
        const pivot = new THREE.Group()
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.18,
          roughness: 0.55,
          metalness: 0.25,
        })
        const size = 0.18 + (i % 3) * 0.04
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 28, 28), mat)
        mesh.position.x = radius
        pivot.add(mesh)

        // Saturn-ish ring for knowledge / automations
        let ring: InstanceType<typeof THREE.Mesh> | undefined
        if (p.id === 'knowledge' || p.id === 'automations') {
          const rg = new THREE.TorusGeometry(size * 1.55, 0.012, 8, 48)
          const rm = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.45,
          })
          ring = new THREE.Mesh(rg, rm)
          ring.rotation.x = Math.PI / 2.4
          mesh.add(ring)
        }

        const orbitLine = new THREE.Line(
          makeOrbitGeometry(radius),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: opts.dark ? 0.18 : 0.12,
          }),
        )
        planetRoot.add(orbitLine)
        planetRoot.add(pivot)

        rec = {
          id: p.id,
          pivot,
          mesh,
          mat,
          ring,
          orbitLine,
          radius,
          speed: 0.12 + (n - i) * 0.035,
          phase: (i / n) * Math.PI * 2,
          baseScale: 1,
          state: p.state,
        }
        planets.set(p.id, rec)
      }

      rec.radius = radius
      rec.state = p.state
      rec.mesh.position.x = radius
      rec.mat.color.setHex(color)
      rec.mat.emissive.setHex(color)

      // state drives glow / scale
      let glow = 0.12
      let sc = 1
      if (p.state === 'running') {
        glow = 0.55
        sc = 1.15
      } else if (p.state === 'blocked' || p.state === 'fail') {
        glow = 0.4
        sc = 0.95
      } else if (p.state === 'done') {
        glow = 0.35
        sc = 1.08
      }
      if (p.progress != null && p.progress > 0) {
        sc *= 0.95 + p.progress * 0.15
      }
      rec.baseScale = sc
      rec.mat.emissiveIntensity = glow

      rec.orbitLine.geometry.dispose()
      rec.orbitLine.geometry = makeOrbitGeometry(radius)
      ;(rec.orbitLine.material as InstanceType<typeof THREE.LineBasicMaterial>).color.setHex(color)
    })
  }

  // shooting star state
  let shootT = -1
  const shootGeo = new THREE.BufferGeometry()
  const shootPos = new Float32Array(6)
  shootGeo.setAttribute('position', new THREE.BufferAttribute(shootPos, 3))
  const shootMat = new THREE.LineBasicMaterial({
    color: 0xffe8c8,
    transparent: true,
    opacity: 0,
  })
  const shoot = new THREE.Line(shootGeo, shootMat)
  scene.add(shoot)

  let heroState: ZoneState = 'idle'
  let hovered: ZoneId | null = null
  let animating = opts.animate
  let raf = 0
  let t0 = performance.now()
  let time = 0
  let disposed = false
  let ptr = { x: 0, y: 0, active: false }
  let nextShoot = 4 + Math.random() * 6

  function applyHero(state: ZoneState) {
    heroState = state
    const hex = STATE_SUN[state]
    sunMat.color.setHex(hex)
    sunMat.emissive.setHex(hex)
    coronaMat.color.setHex(hex)
    corona2Mat.color.setHex(hex)
    sunLight.color.setHex(hex)
    const pulse =
      state === 'running' ? 1.8 : state === 'fail' || state === 'blocked' ? 1.5 : 1.15
    sunMat.emissiveIntensity = pulse
    sunLight.intensity = state === 'running' ? 2.0 : 1.3
  }

  function applyHover() {
    for (const rec of planets.values()) {
      const on = hovered === rec.id
      const sc = rec.baseScale * (on ? 1.55 : 1)
      rec.mesh.scale.setScalar(sc)
      rec.mat.emissiveIntensity = on
        ? Math.min(1.2, rec.mat.emissiveIntensity + 0.5)
        : rec.state === 'running'
          ? 0.55
          : rec.state === 'done'
            ? 0.35
            : 0.15
      const lm = rec.orbitLine.material as InstanceType<typeof THREE.LineBasicMaterial>
      lm.opacity = on ? (opts.dark ? 0.55 : 0.35) : opts.dark ? 0.18 : 0.12
    }
  }

  function tick(now: number) {
    if (disposed) return
    const dt = Math.min(0.05, (now - t0) / 1000)
    t0 = now

    if (animating) {
      const speedMul =
        heroState === 'running' ? 1.45 : heroState === 'idle' ? 0.7 : 1.05
      time += dt * speedMul

      starMat.uniforms.uTime.value = time
      stars.rotation.y = time * 0.012
      belt.rotation.y = time * 0.06

      // sun breathe
      const breathe = 1 + Math.sin(time * 1.4) * 0.04
      sun.scale.setScalar(breathe)
      corona.scale.setScalar(1 + Math.sin(time * 1.1) * 0.06)
      corona2.rotation.y = time * 0.15
      corona2.rotation.z = time * 0.08

      for (const rec of planets.values()) {
        const ang = rec.phase + time * rec.speed
        rec.pivot.rotation.y = ang
        rec.mesh.rotation.y += dt * 0.8
        // slight orbital inclination wobble
        rec.pivot.rotation.x = Math.sin(time * 0.3 + rec.phase) * 0.06
        if (rec.ring) rec.ring.rotation.z += dt * 0.4
      }

      // camera parallax
      const px = ptr.active ? ptr.x * 0.9 : 0
      const py = ptr.active ? ptr.y * 0.5 : 0
      camera.position.x += (px * 1.2 - camera.position.x) * 0.04
      camera.position.y += (4.2 + py * 0.8 - camera.position.y) * 0.04
      camera.lookAt(0, 0.15, 0)

      // shooting star
      nextShoot -= dt
      if (nextShoot <= 0 && shootT < 0) {
        shootT = 0
        nextShoot = 5 + Math.random() * 8
        const sx = -8 + Math.random() * 4
        const sy = 2 + Math.random() * 3
        const sz = -4 + Math.random() * 2
        shootPos[0] = sx
        shootPos[1] = sy
        shootPos[2] = sz
        shootPos[3] = sx + 2.5
        shootPos[4] = sy - 1.2
        shootPos[5] = sz + 1.5
        ;(shoot.geometry.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute>).needsUpdate =
          true
      }
      if (shootT >= 0) {
        shootT += dt
        const life = shootT / 0.85
        shootMat.opacity = life < 1 ? (1 - life) * 0.7 : 0
        if (life >= 1) shootT = -1
        // move streak
        for (let k = 0; k < 6; k++) {
          if (k % 3 === 0) shootPos[k]! += dt * 6
          if (k % 3 === 1) shootPos[k]! -= dt * 2.8
        }
        ;(shoot.geometry.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute>).needsUpdate =
          true
      }
    }

    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf)
      raf = 0
    } else if (animating && !disposed) {
      t0 = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  applyHero('idle')
  raf = requestAnimationFrame(tick)

  return {
    setHeroState(state) {
      applyHero(state)
    },
    setPlanets(list) {
      syncPlanets(list)
      applyHover()
    },
    setHovered(id) {
      hovered = id
      applyHover()
    },
    setPointer(nx, ny, active) {
      ptr = { x: nx, y: ny, active }
    },
    resize(w, h) {
      if (w <= 0 || h <= 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    },
    setAnimating(on) {
      animating = on
      if (on && !raf && !document.hidden) {
        t0 = performance.now()
        raf = requestAnimationFrame(tick)
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const rec of planets.values()) {
        rec.mesh.geometry.dispose()
        rec.mat.dispose()
        rec.orbitLine.geometry.dispose()
        ;(rec.orbitLine.material as InstanceType<typeof THREE.Material>).dispose()
        rec.ring?.geometry.dispose()
        if (rec.ring) (rec.ring.material as InstanceType<typeof THREE.Material>).dispose()
      }
      planets.clear()
      starGeo.dispose()
      starMat.dispose()
      beltGeo.dispose()
      beltMat.dispose()
      sunGeo.dispose()
      sunMat.dispose()
      coronaGeo.dispose()
      coronaMat.dispose()
      corona2Geo.dispose()
      corona2Mat.dispose()
      shootGeo.dispose()
      shootMat.dispose()
      renderer.dispose()
    },
  }
}
