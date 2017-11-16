const { Pool } = require('pg')
const mysql = require('mysql')
const async = require('async')
const bbox = require('@turf/bbox')
const voronoi = require('@turf/voronoi')
const intersect = require('@turf/intersect')
const pip = require('@turf/points-within-polygon')
const wkt = require('wellknown').stringify
const credentials = require('./credentials')
const config = require('./config')

const pgPool = new Pool({
  user: credentials.pg.user,
  port: credentials.pg.port,
  host: credentials.pg.host,
  password: credentials.pg.password,
  database: 'burwell'
})

pgPool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

const mariaPool = mysql.createPool({
  host: credentials.mariadb.host,
  user: credentials.mariadb.user,
  password: credentials.mariadb.password,
  database: 'macrostrat'
})

// Verify a connection has been made
mariaPool.getConnection((error, connection) => {
  if (error) {
    throw new Error('Unable to connect to MySQL. Please check your credentials')
  }
})

function queryPg(query, params, callback) {
  pgPool.connect((err, client, done) => {
    if (err) throw err
    client.query(query, params, (err, res) => {
      done()

      if (err) return callback(err)
      callback(null, res.rows)
    })
  })
}

// Start the process
async.waterfall([
  // Get columns
  (callback) => {
    mariaPool.query(`
      SELECT id, lat, lng
      FROM cols
      WHERE id IN (?)
    `, [ config.col_ids ], (error, result) => {
      if (error) {
        console.log(error)
        process.exit(1)
      }
      callback(null, result)
    })
  },
  // Get clip polygon
  (columns, callback) => {
    let sql = ''
    let params = []

    if (config.clip_sql) {
      sql = config.clip_sql
    } else {
      sql = `
        SELECT ST_AsGeoJSON((ST_dump(ST_Union(geom))).geom) AS geom
        FROM geologic_boundaries.boundaries
        WHERE
      `
      if (config.boundary_id) {
        sql += ' boundary_id = $1'
        params.push(config.boundary_id)
      } else if (config.boundary_name) {
        sql += ' name = $1'
        params.push(config.boundary_name)
      } else if (config.boundary_group) {
        sql += ' boundary_group = $1'
        params.push(config.boundary_group)
      } else {
        console.log('No valid parameters provided')
        process.exit(1)
      }
    }
    queryPg(sql, params, (error, result) => {
      if (error) {
        console.log(error)
        process.exit(1)
      }
      if (!result.length) {
        console.log('No clip polygons were returned')
        process.exit(1)
      }
      callback(null, columns, JSON.parse(result[0].geom))
    })
  },

  // Create tesselation
  (columns, clipPolygon, callback) => {
    let clipBBox = bbox(clipPolygon)

    // Assemble the column centroids into a valid GeoJSON FeatureCollection
    let columnGeojson = {
      "type": "FeatureCollection",
      "features": columns.map(col => {
        return {
          "type": "Feature",
          "geometry": {
            "type": "Point",
            "coordinates": [ col.lng, col.lat ]
          },
          "properties": {
            "id": col.id
          }
        }
      })
    }

    // Create the tesselation
    // NB: Turf voronoi can only clip by a bbox, not a polygon
    let tesselation = voronoi(columnGeojson, { bbox: clipBBox })

    // Clip the tesselated polygons to the original clip polygon
    tesselation.features = tesselation.features.map(f => {
      let newFeature = intersect(f, clipPolygon)

      // Identify which point a given tesselated polygon contains
      let points = pip(columnGeojson, { "type": "FeatureCollection", "features": [ newFeature ] })
      if (!points.features.length || points.features.length > 1) {
        console.log('Something went very wrong')
        process.exit(1)
      }
      // Assign a column id to the tesselated polygon
      newFeature.properties['id'] = points.features[0].properties.id
      return newFeature
    })

    // Insert the new polygons into MariaDB
    async.eachLimit(tesselation.features, 1, (feature, done) => {
      mariaPool.query(`
        UPDATE col_areas
        SET col_area = ST_GeomFromText(?)
        WHERE col_id = ?
      `, [ wkt(f.geometry), f.properties.id ], (error) => {
        if (error) {
          console.log(error)
        }
        done()
      }, (error) => {
        console.log('Done')
        process.exit(0)
      })
    })

  }
])
