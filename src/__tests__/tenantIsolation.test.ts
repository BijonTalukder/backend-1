/// <reference path="../types/index.d.ts" />
// One business must not be able to read or write another's data through
// sales/purchases (party ids), categories, transaction categories or meals.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import Category from '../models/category.model';
import TransactionCategory from '../models/transaction-category.model';
import { saleController } from '../controllers/sale.controller';
import { purchaseController } from '../controllers/purchase.controller';
import { categoryController } from '../controllers/category.controller';
import { transactionCategoryController } from '../controllers/transaction-category.controller';
import { mealController } from '../controllers/meal.controller';

type AnyFn = (...args: any[]) => any;
const restores: (() => void)[] = [];
/** Replace a static model method for one test. */
const stub = (target: object, key: string, fn: AnyFn) => {
  const t = target as Record<string, unknown>;
  const original = t[key];
  t[key] = fn;
  restores.push(() => (t[key] = original));
};
afterEach(() => restores.splice(0).reverse().forEach((r) => r()));

const myUser = new Types.ObjectId();
const myBiz = new Types.ObjectId();
const otherBiz = new Types.ObjectId();

/** Memberships: I am the owner of myBiz only. Matches filters like MongoDB would. */
const membersFindOne = (filter: Record<string, any>) => {
  const same = (a: unknown, b: unknown) => String(a) === String(b);
  const ok =
    same(filter.user, myUser) &&
    same(filter.business, myBiz) &&
    (filter.status === undefined || filter.status === true) &&
    (!filter.role?.$in || filter.role.$in.includes('owner'));
  return Promise.resolve(ok ? { role: 'owner', status: true } : null);
};

const fakeRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return res;
};

/** Run an asyncHandler-wrapped controller and return the error it passed to next(). */
const runForError = (handler: AnyFn, req: any) =>
  new Promise<unknown>((resolve) => {
    const res = fakeRes();
    res.json = (b: unknown) => resolve({ responded: b });
    handler({ user: { _id: myUser, role: 'user' }, params: {}, query: {}, ...req }, res, resolve);
  });

const isApiError = (status: number) => (err: unknown) => err instanceof ApiError && err.statusCode === status;

describe('sales and purchases only accept this business’s customers / suppliers', () => {
  const item = [{ product: new Types.ObjectId().toString(), quantity: 1, unitPrice: 10 }];

  it('rejects a customer id from another business', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    let asked: any;
    stub(Customer, 'exists', (filter: any) => ((asked = filter), Promise.resolve(null)));
    const err = await runForError(saleController.createSale, {
      body: { businessId: myBiz.toString(), customerId: new Types.ObjectId().toString(), items: item },
    });
    assert.ok(isApiError(404)(err), String(err));
    assert.equal(String(asked.business), String(myBiz), 'the lookup is scoped to the caller’s business');
  });

  it('rejects a supplier id from another business', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    stub(Supplier, 'exists', () => Promise.resolve(null));
    const err = await runForError(purchaseController.createPurchase, {
      body: { businessId: myBiz.toString(), supplierId: new Types.ObjectId().toString(), items: item },
    });
    assert.ok(isApiError(404)(err), String(err));
  });
});

describe('transaction categories', () => {
  it('refuses to list another business’s categories', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    const err = await runForError(transactionCategoryController.getTransactionCategories, {
      params: { businessId: otherBiz.toString() },
    });
    assert.ok(isApiError(403)(err), String(err));
  });

  it('ignores server-owned fields in the body (createdBy:null used to make a category global)', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    let created: any;
    stub(TransactionCategory, 'create', (doc: any) => ((created = doc), Promise.resolve(doc)));
    await runForError(transactionCategoryController.createTransactionCategory, {
      body: { businessId: myBiz.toString(), name: 'Rent', createdBy: null, business: otherBiz.toString(), isGlobal: true },
    });
    assert.equal(String(created.business), String(myBiz));
    assert.equal(String(created.createdBy), String(myUser));
    assert.equal(created.isGlobal, false);
  });

  it('refuses to rename another business’s category', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    stub(TransactionCategory, 'findById', () => Promise.resolve({ business: otherBiz, status: true }));
    const err = await runForError(transactionCategoryController.updateTransactionCategory, {
      params: { id: new Types.ObjectId().toString() },
      body: { name: 'pwned' },
    });
    assert.ok(isApiError(403)(err), String(err));
  });
});

describe('product categories', () => {
  it('refuses to edit another business’s category', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    stub(Category, 'findById', () => Promise.resolve({ business: otherBiz, status: true }));
    const err = await runForError(categoryController.updateCategory, {
      params: { id: new Types.ObjectId().toString() },
      body: { name: 'pwned', business: myBiz.toString() },
    });
    assert.ok(isApiError(403)(err), String(err));
  });

  it('refuses to delete someone else’s global category', async () => {
    stub(Category, 'findById', () => Promise.resolve({ business: null, createdBy: new Types.ObjectId(), status: true }));
    const err = await runForError(categoryController.deleteCategory, { params: { id: new Types.ObjectId().toString() } });
    assert.ok(isApiError(403)(err), String(err));
  });
});

describe('meals', () => {
  it('rejects an operator object as businessId ({"$ne": null} matched any business)', async () => {
    let membershipQueried = false;
    stub(BusinessMembersModel, 'findOne', () => ((membershipQueried = true), Promise.resolve({ role: 'owner' })));
    const res = fakeRes();
    await mealController.addMeal(
      { user: { _id: myUser }, body: { businessId: { $ne: null }, memberId: new Types.ObjectId().toString(), count: 99 } } as any,
      res,
    );
    assert.equal(res.statusCode, 403);
    assert.equal(membershipQueried, false);
  });

  it('won’t let an admin log meals for someone outside the mess', async () => {
    stub(BusinessMembersModel, 'findOne', membersFindOne);
    const res = fakeRes();
    await mealController.addMeal(
      { user: { _id: myUser }, body: { businessId: myBiz.toString(), memberId: new Types.ObjectId().toString(), count: 2 } } as any,
      res,
    );
    assert.equal(res.statusCode, 400);
  });
});
