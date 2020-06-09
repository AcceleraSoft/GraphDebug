
// Get a reference to the VS Code webview api.
// We use this API to post messages back to our extension.

// @ts-ignore
//const vscode = acquireVsCodeApi();

// Now get a reference to our created canvas
const canvas = document.getElementById('canvas')! as HTMLCanvasElement;

// This function will be called each time the window is resized
// We need to set the canvas resolution and re-draw
function updateSize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', updateSize);

const ctx = canvas.getContext('2d')!;

ctx.fillStyle = 'red';
ctx.fillRect(100, 100, 100, 100);

