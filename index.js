const fetch = require('node-fetch');
require('dotenv').config();

// Setting the timeframe - January 2023
const startDate = '2023-1-1'
const endDate = '2023-1-31'


/*

1. The monthly energy consumed by the building (kWh)

*/
// Here I am just using openvolt's monthly granularity to get the entire month's consumption data
const url = `https://api.openvolt.com/v1/interval-data?meter_id=6514167223e3d1424bf82742&granularity=month&start_date=${startDate}&end_date=${endDate}`;
const options = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    'x-api-key': 'test-Z9EB05N-07FMA5B-PYFEE46-X4ECYAR'
  }
};

// fetch data and print results
console.log('1. The monthly energy consumed by the building (kWh):')
fetch(url, options)
  .then(res => res.json())
  .then(res => console.log(res.data[0].consumption, 'kWh \n'))
  .catch(err => console.error('error:' + err));


/*

  2. The amount of CO2 (kgs) emitted by the electricity generated for the building

*/
// Switch granularity to half hour
const url2 = `https://api.openvolt.com/v1/interval-data?meter_id=6514167223e3d1424bf82742&granularity=hh&start_date=${startDate}&end_date=${endDate}`;
fetch(url2, options)
  .then(res => res.json())
  .then(async (res) => {
  // Set a start var to calculate computing time
  let start = performance.now();

  /* I want to first fetch the entire month of data for the carbon intensity, so i'm cycling through the consumption data 48h at a time (96 half hours)
  Doing it this way means I only do 15 requests to carbon intensity's API, using the endpoint /fw48h */
  let carbonIntensityPromises = [];
  for (let i = 0; i < res.data.length; i += 96) {
    const carbonIntensityUrl = `https://api.carbonintensity.org.uk/intensity/${res.data[i].start_interval}/fw48h`;
    carbonIntensityPromises.push(fetch(carbonIntensityUrl));
  }

  // resolve and await for promises
  const carbonIntensityResponses = await Promise.all(carbonIntensityPromises);

  // parse json and store the results in an array
  let carbonIntensityDataArray = [];
  for (const response of carbonIntensityResponses) {
    const data = await response.json();
    carbonIntensityDataArray.push(data);
  }

  // Now I can cycle through all data points from OpenVolt's response and calculate the CO2 emitted
  let totalCO2Emissions = 0;
  for (let i = 0; i < res.data.length; i++) {
    const dataPoint = res.data[i];

    // Here I get the index for the carbon intensity array by dividing by the same factor of 96 as before
    const carbonIntensityData = carbonIntensityDataArray[Math.floor(i / 96)];

    // Here the modulo operator cycles through the 96 half hour entries present in each carbonIntensityDataArray entry
    const CO2Emissions = dataPoint.consumption * carbonIntensityData.data[i % 96].intensity.actual;

    // Sum to the total
    totalCO2Emissions += CO2Emissions;
  }

  let end = performance.now();

  // Print the results
  console.log('2. The amount of CO2 (kgs) emitted by the electricity generated for the building:')
  console.log(`Total CO2 emissions: ${totalCO2Emissions} kg`);
  console.log(`Time taken: ${(end - start).toFixed(2)} ms \n`);
})
.catch(err => console.error('error:' + err));


/*

3. The % of fuel mix (wind/solar/nuclear/coal/etc) used to generate the electricity.

*/
fetch(url2, options)
.then(res => res.json())
.then(async (res) => {
  let start = performance.now();

  // initializing the object to store different percentages for different fuel types
  let totalEnergyConsumptionByFuel = {
    wind: 0,
    solar: 0,
    nuclear: 0,
    coal: 0,
    other: 0,
    gas: 0,
    biomass: 0,
    hydro: 0,
    imports: 0,
  };

  // I want to first fetch the entire month of data for the generation mix, so i'm cycling through the consumption data 24h at a time (48 half hours)
  // (Side Note: I also tried the endpoint /generation/{from}/{to} in order to only do one request, but the response seemed to take about double the time compared to doing it this way)
  let fuelMixPromises = [];
  for (let i = 0; i < res.data.length; i += 48) {
    const startInterval = new Date(res.data[i].start_interval);
    
    // here I need to add 24 because the response is for the previous 24h from the given timestamp
    startInterval.setHours(startInterval.getHours() + 24);

    const generationMixUrl = `https://api.carbonintensity.org.uk/generation/${startInterval.toISOString()}/pt24h`;
    fuelMixPromises.push(fetch(generationMixUrl));
  }

  // resolve and await for promises
  const fuelMixResponses = await Promise.all(fuelMixPromises);

  // parse json and store the results in an array
  let fuelMixDataArray = [];
  for (const response of fuelMixResponses) {
    const data = await response.json();
    fuelMixDataArray.push(data);
  }

  // Now I can cycle through all data points from OpenVolt's response and calculate the weighted average for each fuel source
  for (let i = 0; i < res.data.length; i++) {
    const dataPoint = res.data[i];

    // Here I get the index for the fuel mix array by dividing by the same factor of 48 as before
    const fuelMixData = fuelMixDataArray[Math.floor(i / 48)];

    // Here the modulo operator cycles through the 48 half hour entries present in each fuelMixData entry
    // This forEach loop cycles through the 9 different fuel types
    fuelMixData.data[i % 48].generationmix.forEach(fuelType => {
      // Here I multiply with the consumption to get the weight of each fuel type for the weighted average
      totalEnergyConsumptionByFuel[fuelType.fuel] += dataPoint.consumption * fuelType.perc;
    });
  }

  // Now I calculate the total energy consumption to use in the average calculation
  const totalEnergyConsumption = Object.values(totalEnergyConsumptionByFuel).reduce((a, b) => a + b, 0);

 
  console.log('3. The % of fuel mix (wind/solar/nuclear/coal/etc) used to generate the electricity:')
  // Cycle through fuel types, calculate the average and print results
  for (const fuel in totalEnergyConsumptionByFuel) {
    const percentage = (totalEnergyConsumptionByFuel[fuel] / totalEnergyConsumption) * 100;
    console.log(`${fuel}: ${percentage.toFixed(2)}%`);
  }

  let end = performance.now();
  console.log(`Time taken: ${(end - start).toFixed(2)} ms`);
})
.catch(err => console.error('error:' + err));
