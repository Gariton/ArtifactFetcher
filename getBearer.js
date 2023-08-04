process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const axios = require('axios');
const cliArgs = process.argv.slice(2); // Get command line arguments

const repo = cliArgs[0]; // Docker image repository name from arguments

async function displayBearer(repo) {
    const tokenResponse = await axios.get(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`);
    const token = tokenResponse.data.token;
    console.log(`Bearer ${token}`);
}

displayBearer(repo);