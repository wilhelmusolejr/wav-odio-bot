import { motion } from "framer-motion";

export default function Orbs() {
  return (
    <>
      {/* Orb 1 */}
      <motion.div
        className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-indigo-500/20 blur-[180px]"
        animate={{
          x: [0, 60, 0],
          y: [0, -80, 0],
        }}
        transition={{
          duration: 28,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Orb 2 */}
      <motion.div
        className="absolute top-1/3 -right-40 w-[460px] h-[460px] rounded-full bg-cyan-500/20 blur-[180px]"
        animate={{
          x: [0, -70, 0],
          y: [0, 90, 0],
        }}
        transition={{
          duration: 32,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Orb 3 (very subtle) */}
      <motion.div
        className="absolute bottom-[-200px] left-1/3 w-[380px] h-[380px] rounded-full bg-purple-500/15 blur-[200px]"
        animate={{
          y: [0, -60, 0],
        }}
        transition={{
          duration: 40,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </>
  );
}
