const http = require('http');
const next = require('next');

const dev = false;
const app = next({ dev });
const handle = app.getRequestHandler();
const port = Number(process.env.PORT || 3001);

app.prepare().then(() => {
  http
    .createServer((req, res) => {
      handle(req, res);
    })
    .listen(port, '0.0.0.0', () => {
      console.log(`Frontend listening on port ${port}`);
    });
});
