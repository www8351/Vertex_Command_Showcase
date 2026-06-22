import { createContext, useContext } from "react";

export const DemoContext = createContext(false);
export function useIsDemo() { return useContext(DemoContext); }
