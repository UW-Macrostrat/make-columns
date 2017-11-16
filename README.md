# Make columns

This script takes Macrostrat column centroids and a clip polygon to create tesselated column polygons

### Setup
First, install dependencies
````
npm install
````

Next, copy the credentials file and edit it with your credentials
````
cp credentials.js.example credentials.js
vi credentials.js
````

Finally, edit `config.js` with your desired columns and clip parameters

### Use
````
node index.js
````
