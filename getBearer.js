process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const axios = require('axios');
const cliArgs = process.argv.slice(2); // Get command line arguments

const repo = cliArgs[0]; // Docker image repository name from arguments

if (!repo) {
  console.error('Please provide a repository as argument');
  process.exit(1);
}

async function displayBearer(repository) {
  const tokenResponse = await axios.get(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`
  );
  const token = tokenResponse.data.token;
  console.log(`Bearer ${token}`);
}

displayBearer(repo);
