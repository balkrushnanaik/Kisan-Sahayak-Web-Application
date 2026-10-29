import { expect, request, test, type APIRequestContext } from '@playwright/test';

const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const mutationHeaders = { 'X-Requested-With': 'XMLHttpRequest' };
const futureDate = (days = 7) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const location = { village: 'Demo Village', taluka: 'Demo Taluka', district: 'Pune', state: 'Maharashtra' };
const wage = (amount: number) => ({ amount, basis: 'worker_day', currency: 'INR' });
let counter = 0;

async function newApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: `${apiBase}/`, extraHTTPHeaders: mutationHeaders });
}

async function register(api: APIRequestContext, role: 'farmer' | 'labourer' | 'machinery_provider') {
  counter += 1;
  const email = `${role}.${Date.now()}.${counter}@e2e.kisansahayak.example`;
  const response = await api.post('auth/register', {
    data: {
      name: `E2E ${role} ${counter}`,
      email,
      password: 'FarmWork-E2E-2026!',
      preferredLanguage: 'en',
      role,
      termsAccepted: true,
    },
  });
  expect(response.status(), `register ${role}: ${await response.text()}`).toBe(201);
  const body = await response.json();
  expect(body.data.user.roles).toContain(role);
  return body.data.user as { _id: string; email: string; roles: string[] };
}

async function createJob(api: APIRequestContext, suffix = 'Harvesting') {
  const response = await api.post('jobs', {
    data: {
      title: `${suffix} E2E ${Date.now()}`,
      category: 'harvesting',
      crop: 'Wheat',
      description: 'Demonstration job created by an automated end-to-end test.',
      requiredSkills: ['Harvesting'],
      location,
      workDate: futureDate(),
      startTime: '08:00',
      durationHours: 6,
      workersNeeded: 2,
      wage: wage(700),
      status: 'open',
    },
  });
  expect(response.status(), `create job: ${await response.text()}`).toBe(201);
  return (await response.json()).data as { _id: string; title: string; status: string };
}

async function enableWorkerAvailability(api: APIRequestContext) {
  const response = await api.patch('auth/me', {
    data: {
      labourerProfile: {
        available: true,
        skills: ['Harvesting', 'Weeding'],
        experienceYears: 3,
        serviceArea: location,
        expectedWage: wage(750),
      },
    },
  });
  expect(response.status(), `update labourer profile: ${await response.text()}`).toBe(200);
}

test.describe('Kisan Sahayak public experience', () => {
  test('landing page is responsive on desktop and small mobile without horizontal overflow', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Find the right farm workers');
    await expect(page.getByRole('link', { name: /find farm work/i }).first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document, `horizontal overflow at viewport ${dimensions.viewport}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});

test.describe('Kisan Sahayak database-backed workflows', () => {
  test('a registered account can sign in through the web form', async ({ page }) => {
    const api = await newApi();
    let email = '';
    try {
      const user = await register(api, 'farmer');
      email = user.email;
    } finally {
      await api.dispose();
    }
    await page.goto('/login');
    await page.getByLabel(/email or mobile/i).fill(email);
    await page.getByLabel(/^password$/i).fill('FarmWork-E2E-2026!');
    await page.getByRole('button', { name: /^log in$/i }).click();
    await expect(page).toHaveURL(/\/app(?:$|\/)/);
    await expect(page.getByText(/dashboard|welcome back/i).first()).toBeVisible();
  });

  test('farmer publishes a job and sees it in public search', async () => {
    const farmerApi = await newApi();
    try {
      await register(farmerApi, 'farmer');
      const job = await createJob(farmerApi);
      const response = await farmerApi.get(`jobs?q=${encodeURIComponent(job.title)}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.some((item: { _id: string }) => item._id === job._id)).toBeTruthy();
    } finally {
      await farmerApi.dispose();
    }
  });

  test('labourer applies, farmer offers, and accepted terms create an assignment', async () => {
    const farmerApi = await newApi();
    const workerApi = await newApi();
    try {
      await register(farmerApi, 'farmer');
      await register(workerApi, 'labourer');
      await enableWorkerAvailability(workerApi);
      const job = await createJob(farmerApi, 'Weeding');

      const applicationResponse = await workerApi.post(`jobs/${job._id}/applications`, { data: { message: 'Available on the requested date.', relevantExperience: 'Three seasons' } });
      expect(applicationResponse.status(), `apply: ${await applicationResponse.text()}`).toBe(201);
      const application = (await applicationResponse.json()).data;

      const offerResponse = await farmerApi.post('work-requests', {
        data: {
          labourerId: application.labourer,
          jobId: job._id,
          title: job.title,
          category: 'harvesting',
          workDate: futureDate(),
          durationHours: 6,
          location,
          workersCount: 1,
          proposedWage: wage(700),
          note: 'Offer created by E2E test.',
        },
      });
      expect(offerResponse.status(), `offer: ${await offerResponse.text()}`).toBe(201);
      const offer = (await offerResponse.json()).data;

      const acceptResponse = await workerApi.post(`work-requests/${offer._id}/respond`, { data: { action: 'accept' } });
      expect(acceptResponse.status(), `accept offer: ${await acceptResponse.text()}`).toBe(200);
      const accepted = (await acceptResponse.json()).data;
      expect(accepted.assignment.status).toBe('confirmed');
      expect(accepted.assignment.agreedWage.amount).toBe(700);

      const assignments = await farmerApi.get('assignments/mine?limit=50');
      expect(assignments.status()).toBe(200);
      expect((await assignments.json()).data.some((item: { _id: string }) => item._id === accepted.assignment._id)).toBeTruthy();
    } finally {
      await Promise.all([farmerApi.dispose(), workerApi.dispose()]);
    }
  });

  test('direct invitation can be counter-proposed and accepted by the farmer', async () => {
    const farmerApi = await newApi();
    const workerApi = await newApi();
    try {
      await register(farmerApi, 'farmer');
      const worker = await register(workerApi, 'labourer');
      await enableWorkerAvailability(workerApi);
      const offerResponse = await farmerApi.post('work-requests', {
        data: {
          labourerId: worker._id,
          title: `Orchard pruning E2E ${Date.now()}`,
          category: 'pruning',
          workDate: futureDate(10),
          durationHours: 5,
          location,
          workersCount: 1,
          proposedWage: wage(650),
          note: 'Initial invitation.',
        },
      });
      expect(offerResponse.status(), `create invitation: ${await offerResponse.text()}`).toBe(201);
      const offer = (await offerResponse.json()).data;

      const counterResponse = await workerApi.post(`work-requests/${offer._id}/counter-offer`, { data: { wage: wage(850), note: 'Counter-proposal for the day.' } });
      expect(counterResponse.status(), `counter-offer: ${await counterResponse.text()}`).toBe(200);
      const acceptResponse = await farmerApi.post(`work-requests/${offer._id}/respond`, { data: { action: 'accept_counter' } });
      expect(acceptResponse.status(), `accept counter: ${await acceptResponse.text()}`).toBe(200);
      const accepted = (await acceptResponse.json()).data;
      expect(accepted.assignment.agreedWage.amount).toBe(850);
      expect(accepted.assignment.status).toBe('confirmed');
    } finally {
      await Promise.all([farmerApi.dispose(), workerApi.dispose()]);
    }
  });

  test('provider lists machinery and farmer can request a booking', async () => {
    const providerApi = await newApi();
    const farmerApi = await newApi();
    try {
      await register(providerApi, 'machinery_provider');
      await register(farmerApi, 'farmer');
      const listingResponse = await providerApi.post('machinery', {
        data: {
          category: 'tractor',
          name: `Demo tractor E2E ${Date.now()}`,
          model: 'E2E model',
          description: 'Listing created for the automated booking test.',
          photos: [],
          specifications: { horsepower: '45 HP' },
          location,
          rentalRate: { amount: 1800, basis: 'day_rental', currency: 'INR' },
          minDuration: 1,
          operatorIncluded: true,
          fuelIncluded: false,
          transportDetails: 'Transport to be agreed with provider.',
          available: true,
          status: 'active',
        },
      });
      expect(listingResponse.status(), `create listing: ${await listingResponse.text()}`).toBe(201);
      const listing = (await listingResponse.json()).data;

      const bookingResponse = await farmerApi.post('bookings', {
        data: {
          listingId: listing._id,
          requestedStart: futureDate(12),
          durationHours: 8,
          location,
          intendedUse: 'Land preparation',
        },
      });
      expect(bookingResponse.status(), `create booking: ${await bookingResponse.text()}`).toBe(201);
      const booking = (await bookingResponse.json()).data;
      const providerResponse = await providerApi.post(`bookings/${booking._id}/respond`, { data: { action: 'accept' } });
      expect(providerResponse.status(), `accept booking: ${await providerResponse.text()}`).toBe(200);
      expect((await providerResponse.json()).data.status).toBe('confirmed');
    } finally {
      await Promise.all([providerApi.dispose(), farmerApi.dispose()]);
    }
  });

  test('a different farmer cannot edit someone else\'s job', async () => {
    const ownerApi = await newApi();
    const strangerApi = await newApi();
    try {
      await register(ownerApi, 'farmer');
      await register(strangerApi, 'farmer');
      const job = await createJob(ownerApi, 'Unauthorized edit guard');
      const response = await strangerApi.patch(`jobs/${job._id}`, { data: { title: 'Attempted cross-account edit' } });
      expect(response.status()).toBe(403);
    } finally {
      await Promise.all([ownerApi.dispose(), strangerApi.dispose()]);
    }
  });
});
