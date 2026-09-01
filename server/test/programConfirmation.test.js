import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw } from './helpers/source.js';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js';
import { CONTACT_EMAIL, contactIsUsable } from '../../web/src/lib/contact.js';

const route = readSource(new URL('../src/routes/chat.js', import.meta.url));
const chatPage = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));
const prompt = buildSystemPrompt({ profile: { units: 'lb' } });

describe('THE APP SAYS WHAT THE APP KNOWS', () => {
  /*
   * The coach told an athlete it had added his program to the Program page.
   * It had - the first program this product ever stored. But the coach could
   * not have known: the write happens after it has finished speaking, and it
   * can fail on the clearance gate, on validation, or on the database. It was
   * right by luck, and the athlete noticed the tension.
   */
  test('the response carries what actually landed, not what was attempted', () => {
    assert.match(route, /savedProgram,/);
    assert.match(route, /let savedProgram = null;/);
    // Assigned only in the branch where the insert returned no error.
    const saveBlock = route.slice(route.indexOf("from('workout_programs').insert"), route.indexOf('savedProgram = {') + 200);
    assert.match(saveBlock, /if \(error\)[\s\S]*else \{[\s\S]*savedProgram = \{/);
  });

  test('it carries week and phase, never the training itself', () => {
    // The Program page fetches the movements under the athlete's own token. A
    // chat response is not the place to widen what travels.
    const assignment = route.slice(route.indexOf('savedProgram = {'), route.indexOf('savedProgram = {') + 140);
    assert.match(assignment, /week: storable\.week/);
    assert.match(assignment, /phase: storable\.phase/);
    assert.match(assignment, /days: storable\.days\.length/);
    assert.doesNotMatch(assignment, /exercises|program_data|storable,/);
  });

  test('the confirmation clears on the next send so it cannot describe an older turn', () => {
    const send = chatPage.slice(chatPage.indexOf('function send(event)'), chatPage.indexOf('function undoSend'));
    assert.match(send, /setSavedProgram\(null\)/);
  });

  test('it renders only when the server said so, and links to the page', () => {
    assert.match(chatPage, /\{savedProgram && \(/);
    assert.match(chatPage, /to="\/program"/);
    assert.match(chatPage, /setSavedProgram\(result\.savedProgram \?\? null\)/);
  });
});

describe('THE COACH IS TOLD NOT TO CLAIM WHAT IT CANNOT SEE', () => {
  test('it is told the storing happens after it stops speaking', () => {
    assert.match(prompt, /the storing happens after you have finished speaking/);
    assert.match(prompt, /do not tell an athlete that something has been saved/i);
  });

  test('and to believe an athlete who says it did not show up', () => {
    // The failure mode worth naming: the model defending its own claim against
    // a person looking at the screen.
    assert.match(prompt, /believe them/);
  });
});

describe('THERE IS AN ANSWER TO "WHO DO I CONTACT"', () => {
  test('the live address reaches the prompt', () => {
    // It was in the Terms, the health-data policy and the maintenance page,
    // and in none of the text the coach reads - so an athlete asking the coach
    // how to reach a person got nothing.
    assert.equal(contactIsUsable(), true, 'contact is not live; the branch below is the other one');
    assert.ok(prompt.includes(CONTACT_EMAIL), 'the contact address is not in the prompt');
  });

  test('the prompt takes it from the module rather than repeating it', () => {
    // Three documents already share this string. A fourth copy is a fourth
    // chance for them to promise different routes.
    const source = readRaw(new URL('../src/prompts/systemPrompt.js', import.meta.url));
    assert.match(source, /import \{ CONTACT_EMAIL, contactIsUsable \}/);
    assert.doesNotMatch(source, /privacy@coachdiaz\.app/, 'the address is hardcoded in the prompt');
  });

  test('and it says nothing exists when nothing does', () => {
    // The flag is the whole point of the contact module: a document naming an
    // address that bounces is worse than one naming none, and the same is true
    // of a coach.
    const source = readRaw(new URL('../src/prompts/systemPrompt.js', import.meta.url));
    assert.match(source, /There is no working support address yet/);
    assert.match(source, /rather than inventing one/);
  });
});
