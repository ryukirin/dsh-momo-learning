import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const skill = readFileSync(
  resolve(process.cwd(), '../skills/momo-daily-learning/SKILL.md'),
  'utf8'
);

test('每日学习 Skill 先引导 App，再按作答结果出题，并包含完整中文讲解要求', () => {
  assert.match(skill, /先去 App 完成正式复习/);
  assert.match(skill, /不得用出题代替/);
  assert.match(skill, /核心词义与词性/);
  assert.match(skill, /常见搭配/);
  assert.match(skill, /易混点或记忆提示/);
  assert.match(skill, /带中文翻译/);
  // The app's own verdict decides the scope: a word it confirmed as known is
  // never asked about again, which is what stops the loop repeating the app.
  assert.match(skill, /FAMILIAR` 的词一律不考/);
  // Generated teaching material must never be presented as the account's own.
  assert.match(skill, /不是墨墨账号原文/);
});

test('出题只在用户要求时发生，范围可追溯且题目与答案解析分离', () => {
  assert.match(skill, /只在用户要求开始当天流程或明确要题时出题/);
  // The candidate tool owns the ordering, so the skill cites it instead of
  // re-deriving the tiers from today's snapshot itself.
  assert.match(skill, /maimemo_list_quiz_candidates/);
  assert.match(skill, /本地错题/);
  assert.match(skill, /墨墨标记顽固/);
  // Interference options come from the real plan rather than being invented.
  assert.match(skill, /不得编造不存在的词/);
  assert.match(skill, /单批最多 50 题/);
  assert.match(skill, /题目、答案、解析必须分离/);
  assert.match(skill, /不得声称覆盖全部/);
});

test('出题一题一题弹窗进行，不一次列完', () => {
  assert.match(skill, /一次只问一题/);
  assert.match(skill, /ask_user_question/);
  assert.match(skill, /不得把整套题一次性写进回复/);
  // An option description carrying the meaning would hand over the answer.
  assert.match(skill, /不要写释义/);
  // A session without the popup tool still asks one question at a time.
  assert.match(skill, /一次一题\*\*的普通消息提问/);
});

test('题型只出选择题、禁止对译，且不做需要语篇的题', () => {
  assert.match(skill, /中文猜英语/);
  // The five exam-grounded multiple-choice forms.
  for (const form of ['语境选词', '近义替换', '搭配填空', '形近辨析', '熟词僻义']) {
    assert.ok(skill.includes(form), `Skill 应包含题型 ${form}`);
  }
  // Handing over the root turns the question into mechanical inflection.
  assert.ok(skill.includes('不出「给词根选词形」这类构词题'));
  // A Chinese instruction in the stem gives away both the task and the answer.
  assert.match(skill, /题干只放英文语境，不得出现中文/);
  // The stem must not carry the meaning, which would make it a translation again.
  assert.match(skill, /不得出现该词的中文释义/);
  assert.match(skill, /每题 4 个选项、1 个正确答案/);
  assert.match(skill, /不做需要语篇的题型/);
});

test('从整个镜像取词，排除今天新学的并留出间隔', () => {
  assert.match(skill, /每天固定 \*\*20 题\*\*/);
  assert.match(skill, /不要 n 个词出 n 道题/);
  assert.match(skill, /maimemo_list_quiz_candidates/);
  assert.match(skill, /排除今天新学的词/);
  assert.match(skill, /距上次学习有间隔/);
  // Nothing is permanently skipped: the app's own schedule brings a word back
  // until it is learned, so no quiz-progress state needs to be stored here.
  assert.match(skill, /没考到的词不需要记账/);
});

test('只记错题不留流水，日报落盘到工作区', () => {
  assert.match(skill, /只记错题，不留答题流水/);
  assert.match(skill, /maimemo_record_quiz_mistakes/);
  assert.match(skill, /答对的词\*\*不写任何记录\*\*/);
  assert.match(skill, /今日日报/);
  assert.match(skill, /需要加强的知识点/);
  assert.match(skill, /累计错了几次/);
  // A report is a document for a human, so it is written as a file, while the
  // queryable facts stay in the database.
  assert.match(skill, /日报落盘成文件/);
  assert.match(skill, /reports\/` 目录/);
  assert.match(skill, /momo-YYYY-MM-DD\.md/);
});

test('解析无论对错都写中文释义', () => {
  assert.match(skill, /无论答对还是答错，解析里都要写出该词的中文释义/);
});
