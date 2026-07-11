<template>
  <main class="app-page">
    <div class="app-content">
      <header class="brand-lockup">
        <img src="/app-icon.svg" alt="" />
        <h1>A.P YOGA Content Studio</h1>
      </header>

      <button class="primary-action" type="button" @click="$router.push('/studio/new')">
        새 글 만들기
      </button>
      <p class="lead">최대 10장 사진과 짧은 메모로 두 채널 콘텐츠를 만들어요.</p>

      <section class="section-block" aria-labelledby="draft-heading">
        <h2 id="draft-heading" class="section-title">작성 중인 글</h2>
        <div class="empty-row">저장된 임시 글이 없습니다.</div>
      </section>

      <section class="section-block" aria-labelledby="history-heading">
        <h2 id="history-heading" class="section-title">최근 작성 기록</h2>
        <div class="empty-row">완료한 콘텐츠가 이곳에 표시됩니다.</div>
      </section>

      <p class="quiet-note">로컬 기능형 MVP · 브라우저 안에서만 저장됩니다.</p>
    </div>

    <footer class="privacy-rail">
      <div class="privacy-rail__inner">
        <span class="privacy-rail__status">● 임시 저장됨</span>
        <span class="privacy-rail__note">편집 사진은 5일 후 삭제됩니다</span>
      </div>
    </footer>
  </main>
</template>
