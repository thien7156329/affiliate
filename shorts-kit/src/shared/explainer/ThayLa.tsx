import React from "react";
import {Stickman} from "../figures/Stickman";

/**
 * "Thầy Lá" — the channel's narrator: a young science teacher.
 * Round white head, black side-swept fringe, small nón lá tipped back with a chin strap,
 * indigo shirt with a red pen in the pocket, khaki trousers.
 * Keep these fixed: they are the character's identity across every video.
 */
export const THAY_LA = {
  hat: "non_la_back",
  hair: "side_swoop",
  outfit: "teacher_shirt",
  accessory: "none",
  color: "#FFFFFF",
  accent: "#FACC15",
  seed: 7,
  backHandOnHip: true,
  moodFx: false,
} as const;

type StickmanProps = React.ComponentProps<typeof Stickman>;

export const ThayLa: React.FC<Omit<StickmanProps, keyof typeof THAY_LA>> = (props) => (
  <Stickman {...THAY_LA} {...props} />
);
