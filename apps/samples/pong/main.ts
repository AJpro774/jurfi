import '@jurfi/ui';
import { overlaps } from '@jurfi/physics';
import { detectBackend } from '@jurfi/render';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const ball = { x: 100, y: 100, w: 8, h: 8, vx: 2, vy: 1.5 };
const paddle = { x: 300, y: 380, w: 80, h: 8 };
console.info('backend:', detectBackend());

function frame(): void {
  ball.x += ball.vx; ball.y += ball.vy;
  if (ball.x < 0 || ball.x > canvas.width) ball.vx *= -1;
  if (ball.y < 0 || overlaps(ball, paddle)) ball.vy *= -1;
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--jurfi-bg') || 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--jurfi-fg') || 'white';
  ctx.fillRect(ball.x, ball.y, ball.w, ball.h);
  ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
