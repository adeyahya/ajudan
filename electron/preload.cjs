// Bridge for the web app: open a business in its own window, or show the list.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ajudan", {
  app: true,
  openFolder: (dir) => ipcRenderer.invoke("ajudan:open-folder", dir),
  showHome: () => ipcRenderer.invoke("ajudan:show-home"),
});
