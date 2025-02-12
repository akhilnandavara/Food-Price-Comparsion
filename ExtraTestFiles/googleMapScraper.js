
//this script is used to scrape the data from google maps for the predefined restaurant names
const cheerio = require('cheerio'); // For HTML parsing
const puppeteer = require('puppeteer'); // For browser automation

const fuzzball = require('fuzzball'); // For fuzzy string matching
const { RestaurantNames } = require('../dataSets/restaurantNames');

// Entry point of the script
(async () => {
    try {
        // Execute the function to fetch common restaurants
        await fetchCommonRestaurants(RestaurantNames);
    } catch (error) {
        console.error('Error executing main logic:', error);
    }
})();

// Function to fetch data for common restaurants
async function fetchCommonRestaurants(restaurantNames) {
    const commonRestaurants = []; // Initialize an array to store fetched restaurant data

    try {
        // User agent string for browser
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36';
        // Launch Puppeteer browser instance
        const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
        const page = await browser.newPage();

        // Iterate over restaurant names
        for (const restaurantName of restaurantNames) {
            let retryCount = 0;
            const maxRetries = 4;
            try {
                // Scrape data from each URL
                const googleURL = await getGoogleURL(page, restaurantName, ua);
                //scrape google data
                let googleData = await scrapeGoogleRestaurantData(page, googleURL, ua);
                while (googleData.reviews.length === 0 && retryCount < maxRetries) {
                    console.log(`Retrying fetching Google data for ${restaurantName}, attempt ${retryCount + 1}`);
                    googleData = await scrapeGoogleRestaurantData(page, googleURL, ua);
                    retryCount++;
                }
                retryCount = 0;
                commonRestaurants.push(googleData); // Push the fetched data into the commonRestaurants array
            } catch (error) {
                console.error('Error fetching Google data:', error);
            }
        }
        await browser.close(); // Close the browser instance
        console.log(commonRestaurants); // Log the fetched common restaurants
        return commonRestaurants; // Return the common restaurants array
    } catch (error) {
        console.error('Error fetching common restaurants:', error);
    }
}

// Function to get Google URL for a restaurant
async function getGoogleURL(page, restaurantName) {
    try {
        // Navigate to Google Maps
        await page.goto('https://www.google.co.in/maps/@12.962000,77.597038,15z?entry=ttu');

        // Wait for the search input field to appear
        await page.waitForSelector('input[class="searchboxinput xiQnY"]', { timeout: 10000 });

        // Clear the search input field and type the restaurant name
        await page.$eval('input[class="searchboxinput xiQnY"]', inputField => inputField.value = '');
        await page.type('input[class="searchboxinput xiQnY"]', restaurantName);

        // Press Enter to search
        await page.keyboard.press('Enter');

        // Wait for the search results to load
        await page.waitForSelector('.Nv2PK.tH5CWc.THOPZb > a , .Nv2PK.THOPZb.CpccDe  > a', { timeout: 10000 });

        // Extract the names of all search results
        const restaurantNamesInSearch = await page.evaluate(() => {
            const restaurantNameElements = document.querySelectorAll('.qBF1Pd.fontHeadlineSmall');
            return Array.from(restaurantNameElements).map(element => element.textContent.trim());
        });

        // Find the closest matching restaurant name using fuzzy matching
        const closestMatch = fuzzball.extract(restaurantName, restaurantNamesInSearch, { scorer: fuzzball.token_set_ratio });

        if (closestMatch) {
            const closestRestaurantName = closestMatch[0][1]; // Get the closest matching restaurant name
            console.log('Closest matching restaurant name:', closestRestaurantName);
            // Extract the URL of the first search result
            const restaurantURL = await page.evaluate(() => {
                const firstResult = document.querySelector('.Nv2PK.tH5CWc.THOPZb > a , .Nv2PK.THOPZb.CpccDe  > a');
                return firstResult ? firstResult.href : null;
            });
            return restaurantURL;
        } else {
            console.error('No matching restaurant found.');
            return null;
        }
    } catch (error) {
        console.error('Error getting Google URL for', restaurantName, ':', error);
        return null;
    }
}

// Function to scrape restaurant data from Google
async function scrapeGoogleRestaurantData(page, url, ua) {
    try {
        page.setUserAgent(ua);
        await page.goto(url);
        await page.waitForSelector('h1.DUwDvf.lfPIob');

        const htmlContent = await page.content();
        const $ = cheerio.load(htmlContent);


        // Define a regular expression pattern to match latitude and longitude values in the Google Maps URL
        const match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);

        // Extract restaurant data
        const restaurantData = {
            name: $('h1.DUwDvf.lfPIob').text().trim(),
            cuisine: '',
            formattedOpeningHours: [],
            address: '',
            url: $('div.rogA2c.ITvuef').text().trim(),
            phoneNumber: '',
            ratings: [],
            reviews: [],
            latitude: match && match.length >= 3 ? match[1]:null,
            longitude: match && match.length >= 3 ? match[2]:null,
            restoOptions: [], // to store the restaurant options like delivery, takeout, dine-in
        };


        // Extract ratings and number of reviews
        const rating = $('.F7nice > span > span[aria-hidden="true"]').text().trim();
        const reviewsText = $('.F7nice > span > span > span[aria-label]').text().trim();
        const reviewsCount = reviewsText.replace(/[^\d]/g, '');
        const formattedReviews = Number(reviewsCount).toLocaleString();
        restaurantData.ratings.push({ rating: rating, reviews: formattedReviews });

        // Selecting the first child element of div.rogA2c matching div.Io6YTe.fontBodyMedium.kR99db
        const firstChild = $('div.rogA2c > div.Io6YTe.fontBodyMedium.kR99db').first();


        // If the first child element is found, extract its text content
        if (firstChild.length > 0) {
            const restoInfo = firstChild.text().trim();
            restaurantData.address = restoInfo;
        }
        // extract phone number 
        // Find the button element with the unique attribute 'data-item-id'
        const phoneNumberButton = $('button[data-item-id^="phone:tel"]');

        // Extract the value of the 'data-item-id' attribute
        const phoneNumberDataItemId = phoneNumberButton.attr('data-item-id');

        // Split the 'data-item-id' value to get the phone number
        const phoneNumberParts = phoneNumberDataItemId.split(':');

        // Assigning the matched phone number to restaurantData.phoneNumber
        restaurantData.phoneNumber = phoneNumberParts[2];

        const cuisine = $('button[class="DkEaL "]');
        restaurantData.cuisine = cuisine.text().trim();

        // Extract reviews
        $('.jftiEf.fontBodyMedium').each((index, element) => {
            const profileImg = $(element).find('img.NBa7we').attr('src');
            const name = $(element).find('div.d4r55').text().trim();
            const intro = $(element).find('div.RfnDt').text().trim();
            const star = $(element).find('span.kvMYJc').attr('aria-label');
            const postedTime = $(element).find('span.rsqaWe').text().trim();
            const reviewDesc = $(element).find('span.wiI7pd').text().trim();
            restaurantData.reviews.push({ profileImg: profileImg, name: name, intro: intro, star: star, postedTime: postedTime, reviewDesc: reviewDesc });
        });
        // Extract restaurant options
        $('div.LTs0Rc').each((index, element) => {
            const optionText = $(element).text().trim();
            const extracted = optionText.match(/·\s*(.*)/); // Use regex to match the dot and everything following it
            const option = extracted ? extracted[1].trim() : ""; // If a match is found, use the matched text, else use the entire text
            restaurantData.restoOptions.push(option);
        });

        //extract Restaurant timing
        const openingHours = $('div.t39EBf.GUrTXd').attr('aria-label').trim();
        const dayTimePairs = openingHours.split(';').map(pair => pair.trim());


        const formattedOpeningHours = [];

        // Iterate over each day-time pair
        dayTimePairs.forEach(pair => {
            // Split each pair into day and timing
            const [day, timing] = pair.split(',');

            // Format the timing string
            const formattedTiming = timing.replace('am', 'am').replace('pm', 'pm');

            // Construct the formatted opening hour string
            let formattedPair = `${day.trim()}: ${formattedTiming}`;

            // Check if it's Sunday and remove the unwanted text
            if (day.trim() === 'Sunday') {
                formattedPair = formattedPair.replace('Hide open hours for the week', '').trim();
            }

            // Push the formatted pair to the array
            formattedOpeningHours.push(formattedPair);
        });

        restaurantData.formattedOpeningHours = formattedOpeningHours;


        return restaurantData; // Return the extracted restaurant data
    } catch (error) {
        console.error('Error scraping Google restaurant data:', error);
        return { error: 'Error scraping Google restaurant data' };
    }
}