"use client";
// One place registers GSAP's plugins, so every component imports a ready instance.
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export { gsap, ScrollTrigger, useGSAP };

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const MOTION_OFF = "(prefers-reduced-motion: reduce)";
