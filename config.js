module.exports = {
  // *One* of the following four fields must be filled out
  boundary_id: 875,
  boundary_name: '',
  boundary_group: '',
  // You can also specify an arbitrary sql state so long as it returns geojson as 'geom'
  // clip_sql: 'SELECT ST_AsGeoJSON((ST_dump(ST_Union(geom))).geom) AS geom FROM sources.world_basins where basin_name like 'Parana%' limit 1;'
  clip_sql: '',
  // At least one col_id must be specified here
  col_ids: [462, 463, 456],
  col_group_ids: []
}
