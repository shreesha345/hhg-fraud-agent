import React from "react";
import { Composition } from "remotion";
import { FPS, H, PLAN, W } from "./plan";
import { Main } from "./Video";

export const Root: React.FC = () => <Composition id="Main" component={Main} durationInFrames={PLAN.total} fps={FPS} width={W} height={H} />;
