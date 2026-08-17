import { SweepClient } from './infrastructure/worker/SweepClient';
import { App } from './presentation/App';
import './presentation/styles/main.css';

const root = document.querySelector<HTMLDivElement>('#app');

if (root) {
  const sweeps = new SweepClient(
    () =>
      new Worker(new URL('./infrastructure/worker/sweep.worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  new App(root, sweeps, window.location.search);
}
