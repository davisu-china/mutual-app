import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useEffect } from "react";
import { haptic } from "@/lib/haptics";

interface Props {
  myAvatar?: string;
  peerAvatar?: string;
  peerNickname: string;
  onChat: () => void;
  onClose: () => void;
}

/**
 * 配对成功。
 *
 * 这是整个产品情感浓度最高的一屏——用户花了额度、等了回应，终于双向确认。
 * 所以值得单独设计：深色遮罩把用户从浏览状态里抽离出来形成仪式感，
 * 两个头像从左右飞入相撞，撞出一圈光晕。
 *
 * 但**刻意做得克制**：不撒花瓣、不放烟花、不循环播放。
 * 一次清脆的相遇比一场嘈杂的庆典更符合「认真交往」的定位。
 */
export function MatchOverlay({ myAvatar, peerAvatar, peerNickname, onChat, onClose }: Props) {
  useEffect(() => {
    // 安卓有效，iOS 静默跳过——不依赖它，只是锦上添花
    haptic(30);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#1C1618] px-8"
      role="dialog"
      aria-modal="true"
    >
      {/* 径向光晕 */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1.6, opacity: 0.55 }}
        transition={{ delay: 0.28, duration: 0.75, ease: "easeOut" }}
        className="pointer-events-none absolute h-[420px] w-[420px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(228,89,107,.55) 0%, rgba(228,89,107,0) 68%)",
        }}
      />

      {/* 两个头像相撞 */}
      <div className="relative mb-7 flex items-center">
        <motion.div
          initial={{ x: -150, opacity: 0, scale: 0.8 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="h-[76px] w-[76px] overflow-hidden rounded-full border-[2.5px] border-[#1C1618]"
          style={{ boxShadow: "0 0 0 3px rgba(228,89,107,.35)" }}
        >
          {myAvatar ? (
            <img src={myAvatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#F0C6D0] to-[#C9A7B8]" />
          )}
        </motion.div>

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.34, type: "spring", stiffness: 320, damping: 14 }}
          className="z-10 -mx-2 text-[26px] leading-none text-brand"
          style={{ textShadow: "0 0 18px rgba(228,89,107,.9)" }}
        >
          ♥
        </motion.div>

        <motion.div
          initial={{ x: 150, opacity: 0, scale: 0.8 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="h-[76px] w-[76px] overflow-hidden rounded-full border-[2.5px] border-[#1C1618]"
          style={{ boxShadow: "0 0 0 3px rgba(228,89,107,.35)" }}
        >
          {peerAvatar ? (
            <img src={peerAvatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#C7D2E8] to-[#9FAECB]" />
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.36, type: "spring", stiffness: 260, damping: 18 }}
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand/15"
      >
        <Heart size={28} strokeWidth={2} className="text-[#F2748A]" aria-hidden="true" />
      </motion.div>

      <motion.h3
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.42, duration: 0.3 }}
        className="text-[19px] font-bold text-white"
      >
        你们互相喜欢
      </motion.h3>
      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="mb-8 mt-1.5 text-[12.5px] text-white/55"
      >
        你和 {peerNickname} 都对彼此表达了心意
      </motion.p>

      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.58, duration: 0.3 }}
        className="flex w-[210px] flex-col gap-2.5"
      >
        <button
          type="button"
          onClick={onChat}
          className="rounded-full bg-gradient-to-br from-[#EF7183] to-[#D8445C] py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.97]"
        >
          去打个招呼
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/15 py-3 text-[14px] text-white/65 transition-transform active:scale-[0.97]"
        >
          继续看看
        </button>
      </motion.div>
    </motion.div>
  );
}
