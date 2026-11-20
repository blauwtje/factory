import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <App />
      </TooltipProvider>
      <Toaster />
    </MotionConfig>
  </StrictMode>,
);
