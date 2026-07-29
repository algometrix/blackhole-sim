// Fullscreen-triangle vertex shader: positions are already in clip space.
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
