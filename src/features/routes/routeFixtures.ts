/** Route files as the apps write them, for the parser tests. Coordinates are a short loop in Malang. */

/** Strava export: metadata with a time, one track with a name and a type, altitude and time on every point. */
export const STRAVA_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd">
 <metadata>
  <time>2026-10-11T22:14:03Z</time>
 </metadata>
 <trk>
  <name>Lari pagi Alun-Alun</name>
  <type>running</type>
  <trkseg>
   <trkpt lat="-7.9825000" lon="112.6304000">
    <ele>445.2</ele>
    <time>2026-10-11T22:14:03Z</time>
   </trkpt>
   <trkpt lat="-7.9826000" lon="112.6306000">
    <ele>445.0</ele>
    <time>2026-10-11T22:14:09Z</time>
   </trkpt>
   <trkpt lat="-7.9828000" lon="112.6309000">
    <ele>446.1</ele>
    <time>2026-10-11T22:14:15Z</time>
   </trkpt>
   <trkpt lat="-7.9831000" lon="112.6311000">
    <ele>448.6</ele>
    <time>2026-10-11T22:14:21Z</time>
   </trkpt>
   <trkpt lat="-7.9835000" lon="112.6313000">
    <ele>452.3</ele>
    <time>2026-10-11T22:14:27Z</time>
   </trkpt>
  </trkseg>
 </trk>
</gpx>
`;

/**
 * Garmin Connect export: a link in the metadata, namespaced extensions on every point (heart rate, cadence), a waypoint with a
 * name of its own, an entity and a CDATA in the track name, a repeated point and a point without a fix.
 */
export const GARMIN_GPX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx creator="Garmin Connect" version="1.1"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/11.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns:ns2="http://www.garmin.com/xmlschemas/GpxExtensions/v3"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <link href="connect.garmin.com">
      <text>Garmin Connect</text>
    </link>
    <time>2026-10-12T00:00:00.000Z</time>
  </metadata>
  <wpt lat="-7.9700000" lon="112.6200000">
    <name>Water stop</name>
  </wpt>
  <trk>
    <name><![CDATA[Gowes <Batu> & Sekitar]]></name>
    <type>road_biking</type>
    <trkseg>
      <trkpt lat="-7.9600000" lon="112.6100000">
        <ele>650.0</ele>
        <time>2026-10-12T00:00:00.000Z</time>
        <extensions>
          <ns3:TrackPointExtension>
            <ns3:hr>101</ns3:hr>
            <ns3:cad>80</ns3:cad>
          </ns3:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="-7.9600000" lon="112.6100000">
        <ele>650.4</ele>
        <time>2026-10-12T00:00:01.000Z</time>
      </trkpt>
      <trkpt lat="0.0" lon="0.0">
        <ele>0.0</ele>
      </trkpt>
      <trkpt lat="-7.9610000" lon="112.6120000">
        <ele>652.0</ele>
        <extensions>
          <ns3:TrackPointExtension>
            <ns3:hr>118</ns3:hr>
          </ns3:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="-7.9625000" lon="112.6150000">
        <ele>658.5</ele>
      </trkpt>
      <trkpt lat="-7.9650000" lon="112.6190000">
        <ele>671.9</ele>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
`;

/** A planned route (Komoot, RideWithGPS): `rte/rtept` only, a name in the metadata, no altitude on the middle point. */
export const ROUTE_GPX = `<?xml version="1.0"?>
<gpx version="1.0" creator="planner" xmlns="http://www.topografix.com/GPX/1/0">
  <metadata><name>Rencana &amp; Tanjakan &#x42;romo</name></metadata>
  <rte>
    <rtept lat="-7.9000" lon="112.6000"><ele>900</ele></rtept>
    <rtept lat="-7.9100" lon="112.6100"/>
    <rtept lat="-7.9200" lon="112.6200"><ele>1000</ele></rtept>
    <rtept lat="-7.9300" lon="112.6300"><ele>1100</ele></rtept>
  </rte>
</gpx>
`;

/** A track and a route in one file: the track wins. A prefixed root and single quotes. */
export const PREFIXED_GPX = `<?xml version='1.0'?>
<g:gpx xmlns:g='http://www.topografix.com/GPX/1/1' version='1.1'>
  <g:rte><g:name>Planned</g:name><g:rtept lat='1.0' lon='2.0'/><g:rtept lat='1.1' lon='2.1'/></g:rte>
  <g:trk><g:name>Recorded</g:name><g:trkseg>
    <g:trkpt lat='-7.5' lon='112.5'/><g:trkpt lat='-7.6' lon='112.6'/>
  </g:trkseg></g:trk>
</g:gpx>
`;

/** Garmin course export: a name, a Track of Trackpoints with Position and altitude, and CoursePoints that are not part of the line. */
export const COURSE_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Folders><Courses><CourseFolder Name="Courses"><CourseNameRef><Id>Tanjakan Songgoriti</Id></CourseNameRef></CourseFolder></Courses></Folders>
  <Courses>
    <Course>
      <Name>Tanjakan Songgoriti</Name>
      <Lap>
        <TotalTimeSeconds>0</TotalTimeSeconds>
        <DistanceMeters>1500</DistanceMeters>
        <BeginPosition><LatitudeDegrees>-7.8900</LatitudeDegrees><LongitudeDegrees>112.5300</LongitudeDegrees></BeginPosition>
      </Lap>
      <Track>
        <Trackpoint>
          <Time>2026-10-12T00:00:00Z</Time>
          <Position><LatitudeDegrees>-7.8900</LatitudeDegrees><LongitudeDegrees>112.5300</LongitudeDegrees></Position>
          <AltitudeMeters>800.0</AltitudeMeters>
          <DistanceMeters>0</DistanceMeters>
        </Trackpoint>
        <Trackpoint>
          <Time>2026-10-12T00:01:00Z</Time>
          <Position><LatitudeDegrees>-7.8920</LatitudeDegrees><LongitudeDegrees>112.5320</LongitudeDegrees></Position>
          <AltitudeMeters>812.5</AltitudeMeters>
          <DistanceMeters>300</DistanceMeters>
        </Trackpoint>
        <Trackpoint>
          <Time>2026-10-12T00:02:00Z</Time>
          <Position><LatitudeDegrees>-7.8950</LatitudeDegrees><LongitudeDegrees>112.5350</LongitudeDegrees></Position>
          <AltitudeMeters>830.0</AltitudeMeters>
          <DistanceMeters>900</DistanceMeters>
        </Trackpoint>
      </Track>
      <CoursePoint>
        <Name>Kiri</Name>
        <Time>2026-10-12T00:01:00Z</Time>
        <Position><LatitudeDegrees>-7.5</LatitudeDegrees><LongitudeDegrees>112.0</LongitudeDegrees></Position>
        <PointType>Left</PointType>
      </CoursePoint>
    </Course>
  </Courses>
</TrainingCenterDatabase>
`;

/** A recorded TCX activity: no name, a pause (a Trackpoint without Position) and heart rate on every point. */
export const ACTIVITY_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-10-12T00:00:00Z</Id>
      <Lap StartTime="2026-10-12T00:00:00Z">
        <TotalTimeSeconds>180</TotalTimeSeconds>
        <Track>
          <Trackpoint>
            <Time>2026-10-12T00:00:00Z</Time>
            <Position><LatitudeDegrees>-7.9800</LatitudeDegrees><LongitudeDegrees>112.6300</LongitudeDegrees></Position>
            <AltitudeMeters>440.0</AltitudeMeters>
            <HeartRateBpm><Value>99</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-10-12T00:01:00Z</Time>
            <HeartRateBpm><Value>101</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-10-12T00:02:00Z</Time>
            <Position><LatitudeDegrees>-7.9810</LatitudeDegrees><LongitudeDegrees>112.6310</LongitudeDegrees></Position>
            <AltitudeMeters>441.0</AltitudeMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-10-12T00:03:00Z</Time>
            <Position><LatitudeDegrees>-7.9830</LatitudeDegrees><LongitudeDegrees>112.6330</LongitudeDegrees></Position>
            <AltitudeMeters>445.0</AltitudeMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;

export const NOT_A_ROUTE_XML = `<?xml version="1.0"?><note><to>Budi</to></note>`;

/** A GPX with one point only. */
export const SINGLE_POINT_GPX = `<gpx version="1.1"><trk><trkseg><trkpt lat="-7.98" lon="112.63"/></trkseg></trk></gpx>`;
