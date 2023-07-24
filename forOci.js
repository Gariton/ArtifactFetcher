const axios = require('axios');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const util = require('util');
const pipeline = util.promisify(stream.pipeline);
const ProgressBar = require('progress');
const tar = require('tar');
const cliArgs = process.argv.slice(2); // Get command line arguments

if (cliArgs.length < 2) {
  console.log("Please provide a repository and tag as arguments");
  process.exit(1);
}

const repo = cliArgs[0]; // Docker image repository name from arguments
const tag = cliArgs[1]; // Docker image tag from arguments
const platform = cliArgs[2] || 'linux/arm64';

async function downloadLayer(layer, i, token, downloadPath) {
  try {
    const blobResponse = await axios.get(
      `https://registry-1.docker.io/v2/${repo}/blobs/${layer.digest}`, 
      {
        headers: { 'Authorization': `Bearer ${token}` },
        responseType: 'stream'
      }
    );

    const len = parseInt(blobResponse.headers['content-length'], 10);
    const bar = new ProgressBar(`  downloading layer ${i} [:bar] :rate/bps :percent :etas`, { total: len });

    blobResponse.data.on('data', chunk => bar.tick(chunk.length));

    // Create directory for each layer
    const layerDigest = layer.digest.split(':')[1];
    const layerPath = path.join(downloadPath, layerDigest);
    fs.mkdirSync(layerPath, { recursive: true });

    await pipeline(blobResponse.data, fs.createWriteStream(path.join(layerPath, `layer.tar`)));
  } catch (error) {
    console.log(`　layer${i}のダウンロードに失敗しました。下記URLに下記Bearerをつけて手動ダウンロードしてください。`);
    console.log('********************************************************************************************');
    console.log(`保存先:${path.join(layerPath, 'layer.tar')}`);
    console.log(`https://registry-1.docker.io/v2/${repo}/blobs/${layer.digest}`);
    console.log(`Bearer ${token}`);
    console.log('********************************************************************************************');
  }
}

async function downloadConfig(config, token, downloadPath) {
  const blobResponse = await axios.get(
    `https://registry-1.docker.io/v2/${repo}/blobs/${config.digest}`, 
    {
      headers: { 'Authorization': `Bearer ${token}` },
      responseType: 'stream'
    }
  );

  const configDigest = config.digest.split(':')[1];
  const configPath = path.join(downloadPath, `${configDigest}.json`);

  await pipeline(blobResponse.data, fs.createWriteStream(configPath));
}

// Modify the manifest for docker load
function createDockerLoadManifest(manifest, repo, tag) {
  const configDigest = manifest.config.digest.split(':')[1];

  const loadManifest = [{
    Config: `${configDigest}.json`,
    RepoTags: [`${repo}:${tag}`],
    Layers: manifest.layers.map(layer => {
      const layerDigest = layer.digest.split(':')[1];
      return `${layerDigest}/layer.tar`;
    })
  }];

  return JSON.stringify(loadManifest, null, 2);
}

async function downloadDockerImage(repo, tag, platform) {
  // get token from Docker Hub
  const tokenResponse = await axios.get(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`);
  const token = tokenResponse.data.token;

  // get manifest
  const manifestResponse = await axios.get(
    `https://registry-1.docker.io/v2/${repo}/manifests/${tag}`, 
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.oci.image.index.v1+json'
      }
    }
  );

  let manifest = manifestResponse.data;

  if (manifest.manifests) {
    const platformManifest = manifest.manifests.find(m => m.platform.architecture === platform.split('/')[1] && m.platform.os === platform.split('/')[0]);
    if (!platformManifest) {
      console.error(`No manifest found for platform ${platform}`);
      process.exit(1);
    }
    
    const {token: newToken} = await axios.get(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`).then(d=>d.data);
    const platformManifestResponse = await axios.get(
      `https://registry-1.docker.io/v2/${repo}/manifests/${platformManifest.digest}`,
      {
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Accept': 'application/vnd.oci.image.manifest.v1+json',
        }
      }
    );

    manifest = platformManifestResponse.data;
  }

  console.log(`Total layers to download: ${manifest.layers.length}`);

  // Create a directory for downloads
  const downloadPath = path.join(__dirname, `downloads`, `${repo}@${tag}`);
  fs.mkdirSync(downloadPath, { recursive: true });

  // download config
  await downloadConfig(manifest.config, token, downloadPath);

  // download and save each layer's blob sequentially
  for (let i = 0; i < manifest.layers.length; i++) {
    await downloadLayer(manifest.layers[i], i, token, downloadPath);
  }

  console.log('Download complete');

  // Modify manifest file to match the required structure
  const loadManifest = createDockerLoadManifest(manifest, repo, tag);
  fs.writeFileSync(path.join(downloadPath, 'manifest.json'), loadManifest);

  // Create tar file using Node.js without shell command
  await tar.c(
    {
      file: `downloads/${repo}@${tag}.tar`,
      cwd: downloadPath,
      sync: true
    },
    ['.']
  );
  console.log(`Tar file created at ./downloads/${repo}@${tag}.tar`);
}

downloadDockerImage(repo, tag, platform).catch(console.error);
