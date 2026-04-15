import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import MeetingJoin from "./MeetingJoin";
import MeetingRoom from "./MeetingRoom";
import "./index.css";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const pathname = window.location.pathname;

let RootComponent: React.ComponentType;
if (/^\/meet\/[^/]+/.test(pathname)) {
  RootComponent = MeetingJoin;
} else if (/^\/meeting-room\/[^/]+/.test(pathname)) {
  RootComponent = MeetingRoom;
} else {
  RootComponent = App;
}

createRoot(document.getElementById("root")!).render(<RootComponent />);
