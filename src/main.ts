import './presentation/styles/main.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <main class="mx-auto max-w-3xl p-6">
      <h1 class="text-2xl font-semibold">elevator-sim</h1>
      <p class="mt-2 text-slate-600">
        Describe a building, get the dispatch algorithm comparison. UI lands in milestone 3.
      </p>
    </main>
  `;
}
