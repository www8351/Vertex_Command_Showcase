import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useTelemetryStore } from "@/stores/telemetryStore";

const COLOR_HEALTHY = new THREE.Color("#4f46e5");
const COLOR_RISK = new THREE.Color("#f59e0b");
const COLOR_BREACHED = new THREE.Color("#ef4444");

export default function Scene() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const targetColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    return () => {
      if (mesh) {
        mesh.geometry.dispose();
      }
      if (material) {
        material.dispose();
      }
    };
  }, []);

  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    const { drawdownRisk, dailyPnL, status } = useTelemetryStore.getState();

    if (drawdownRisk < 0.5) {
      targetColor.lerpColors(COLOR_HEALTHY, COLOR_RISK, drawdownRisk * 2);
    } else {
      targetColor.lerpColors(COLOR_RISK, COLOR_BREACHED, (drawdownRisk - 0.5) * 2);
    }

    materialRef.current.color.lerp(targetColor, 0.1);
    materialRef.current.emissive.lerp(targetColor, 0.1);
    materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
      materialRef.current.emissiveIntensity,
      drawdownRisk * 2,
      0.1
    );

    const targetScale = Math.max(0.5, Math.min(1.5, 1 + dailyPnL / 1000));
    meshRef.current.scale.y = THREE.MathUtils.lerp(
      meshRef.current.scale.y,
      targetScale,
      0.1
    );

    const baseSpeed =
      status === "risk" ? 2 : status === "breached" ? 0 : 0.5;
    meshRef.current.rotation.x += delta * baseSpeed;
    meshRef.current.rotation.y += delta * (baseSpeed * 0.8);
  });

  return (
    <>
      <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />

      <mesh ref={meshRef}>
        <torusKnotGeometry args={[1, 0.3, 256, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
    </>
  );
}
