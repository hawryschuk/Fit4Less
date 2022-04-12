const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const moment = require('moment'); moment.suppressDeprecationWarnings = true;
const args = process.argv.reduce((args = {}, arg) => {
    const [_switch] = (/^-([^=-]+)$/.exec(arg) || []).splice(1);
    const [key, val] = (/^--(.+?)=(.*)$/.exec(arg) || []).splice(1);
    return _switch && Object.assign(args, { [_switch]: true })
        || key && Object.assign(args, { [key]: val })
        || args;
});

class Booker {  // browser, page
    destroy = () => this.browser.close();

    constructor({
        idealTime = 'at 6:00 PM',
        email = args.email || process.env.FIT4LESS_EMAIL,
        password = args.password || process.env.FIT4LESS_PASSWORD,
        withinDays = 0,
        minHoursAhead = 0,
        maxHoursAhead = 0,
        debug = 0,
    } = {}) {
        Object.assign(this, { minHoursAhead, withinDays, email, password, debug, idealTime });
        if (!this.email || !this.password) throw new Error('email/password required');
        this.ready = (async () => {
            if (debug) return;
            const puppeteer = require('puppeteer');
            const browser = this.browser = await puppeteer.launch({
                headless: false,
                executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
                // executablePath: 'Y:/PROJECTS/Fit4Less/node_modules/puppeteer/.local-chromium/win64-856583/chrome-win/chrome.exe' // this one crashes on about:page
            });
            const page = this.page = (await browser.pages())[0] || await browser.newPage();
            await page.setViewport({ width: 1280, height: 1200 });
            await this._login();
            return this.page;
        })();
    }

    async _login(page = this.page) {
        await page.goto('https://myfit4less.gymmanager.com/portal/booking/index.asp');
        await page.type('input[type=email]', this.email);
        await page.type('input[type=password]', this.password);
        const n = page.waitForNavigation();
        await page.click('#loginButton');
        await n;
    }

    async use(block) {
        await this.ready;
        const { error, result } = await Promise.resolve(1).then(() => block(this)).then(result => ({ result })).catch(error => ({ error }));
        await this.destroy();
        if (error) throw error;
        else return result;
    }

    get loggedIn() {          // boolean
        return (async () => {
            const page = await this.ready;
            const { length } = page.$x("//h1[contains(text(),'You can have a maximum of')]");
            return length > 0;
        })();
    }

    get maxReached() {          // boolean
        return (async () => {
            const page = await this.ready;
            const { length } = await page.$x("//h2[text()='Maximum personal reservations reached']");
            return length > 0;
        })();
    }

    get datesAvailable() {      // string[]
        return (async () => {
            const page = await this.ready;
            const dates = await page.$$eval('#modal_dates .button.md-option', options => options.map(anchor => anchor.textContent.trim()));
            await pause(2000); // some bug wuth puppeteer says the context isnt ready
            return this.withinDays ? dates.slice(0, this.withinDays) : dates;
        })();
    }

    get bookedTimes() {         // {date,time}[]
        return (async () => {
            if (this.debug) return [
                {
                    club: 'Ottawa South Orleans',
                    date: 'Thursday, 2 March 2021',
                    time: 'at 6:30 PM'
                }
            ];
            const page = await this.ready;
            const timeslots = await page.$$eval('.reserved-slots .time-slot .time-slot-box', elements => Array.from(elements).map(element => {
                const [club, date, time] = Array.from(element.querySelectorAll('.time-slot-data-line')).map(el => el.textContent.trim());
                return { club, date, time };
            }));
            return timeslots;
        })();
    }

    get availableTimeslots() {  // {date,time}[]
        return (async () => {
            if (this.debug) return [
                { date: 'Tuesday, 2 March 2021', time: 'at 11:00 AM' }, /// diff = -1
                { date: 'Wednesday, 3 March 2021', time: 'at 11:00 AM' },   // diff = 0
                { date: 'Thursday, 4 March 2021', time: 'at 8:00 AM' },   // diff = 1
                { date: 'Friday, 5 March 2021', time: 'at 8:00 AM' },   // diff = 2
                { date: 'Friday, 5 March 2021', time: 'at 9:30 AM' },
                { date: 'Friday, 5 March 2021', time: 'at 8:00 PM' }
            ];
            const page = await this.ready;
            const dates = await this.datesAvailable;
            const timeSlots = [];
            for (const date of dates) {
                await this.selectDate({ date });
                const slotTimes = await page.$$eval('.available-slots div.time-slot', slots => slots.map(s => s.getAttribute('data-slottime')));
                timeSlots.push(...slotTimes.map(time => ({ date, time })));
            }
            return timeSlots.filter(ts => !this.minHoursAhead || moment(`${ts.date} ${ts.time.replace(/^at /, '')}`).diff(moment(), 'hours') >= this.minHoursAhead);
        })();
    }

    get idealizedTimeslots() {  // {date,time}[]
        return (async () => {
            const availableTimeslots = await this.availableTimeslots;
            const bookedTimes = await this.bookedTimes;
            const sorted = availableTimeslots.sort((a, b) => { // times closest to idealTime 
                const formatter = time => moment(`${a.date} ${time.replace(/^at /, '')}`);
                const diff = ({ time }) => formatter(time).diff(formatter(this.idealTime), 'hours');
                return moment(a.date).diff(moment(b.date), 'days') || (diff(a) - diff(b));
            });
            const filtered = sorted
                .filter(({ date: date1 }) => {
                    const differences = bookedTimes.map(({ date: date2 }) => moment(date1).diff(moment(date2), 'days'));
                    return differences.every(d => Math.abs(d) > 1); // every difference is 2 days away from all bookings
                });
            console.log({ time: new Date().toLocaleString(), availableTimeslots, bookedTimes, sorted, filtered, datesAvailable: await this.datesAvailable }, '\n');
            return filtered;
        })();
    }

    async selectDate({ date }) {
        const page = await this.ready;
        const dates = await this.datesAvailable;
        await page.click('#btn_date_select');
        await page.waitForSelector('#modal_dates.in');
        const n = page.waitForNavigation();
        await page.click(`#modal_dates .button.md-option:nth-of-type(${dates.indexOf(date) + 1})`);
        await n;
    }

    async book({ date, time }) {
        await this.selectDate({ date });
        const page = await this.ready;
        const selector = `.available-slots div[data-slotdate='${date}'][data-slottime='${time}']`;
        const containsTimeslot = !!(await page.$(selector));
        if (!containsTimeslot)
            console.error('timeslot unavailable');
        else {
            await page.click(selector);
            await page.waitForSelector('#modal_booking.in');
            const n = page.waitForNavigation();
            await page.click('#dialog_book_yes');
            await n;
        }
        debugger;
    }

    async auto() {              // automatically keeps the schedule full applying two business logic rules: a) no back-to-back workout bookings b) closest to 6pm
        while (1) {
            // if (!(await this.loggedIn)) await this._login();
            if (await this.maxReached) {
                await pause(1000 * 60 * 2,);         // 2 minute pause to keep alive
            } else {
                const [idealTime] = await this.idealizedTimeslots;
                if (idealTime) await this.book(idealTime);
                else await pause(1000 * 60 * 1);    // 1 minute pause
            }
        }
    }
}

(async () => {
    while (1) {
        const booker = new Booker({ minHoursAhead: 2 });
        await booker.auto().catch(console.error);
        booker.destroy();
    }
})()